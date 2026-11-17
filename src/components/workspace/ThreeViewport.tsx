import React, { useEffect, useEffectEvent, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { IfcElementGeom, PlanDocument, TakeoffShape } from '../../types/cubit';
import { formatNumber } from '../../utils/estimateCalc';

interface ThreeViewportProps {
  activePlan: PlanDocument | undefined;
  shapes: TakeoffShape[];
  selectedShapeId: string | null;
  isolateSelected: boolean;
  onSelectShape: (shapeId: string | null) => void;
}

export const ThreeViewport: React.FC<ThreeViewportProps> = ({
  activePlan,
  shapes,
  selectedShapeId,
  isolateSelected,
  onSelectShape,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const [hoverInfo, setHoverInfo] = useState<string | null>(null);
  const [xrayMode, setXrayMode] = useState(false);
  const modelRef = useRef<{ group: THREE.Group; pickables: THREE.Object3D[] } | null>(null);
  const selectShape = useEffectEvent(onSelectShape);
  const controlsResetRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch (err) {
      const notice = document.createElement('div');
      notice.className = 'viewport-render-error';
      notice.setAttribute('role', 'status');
      notice.textContent = `3D view unavailable. ${err instanceof Error ? err.message : 'WebGL unavailable'}`;
      container.appendChild(notice);
      return () => notice.remove();
    }

    const width = Math.max(300, container.clientWidth);
    const height = Math.max(240, container.clientHeight);
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#eef2f6');

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 500);
    camera.position.set(16, 15, 20);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.set(0, 1.2, 0);
    controls.update();
    controls.saveState();

    // Lighting
    scene.add(new THREE.AmbientLight('#ffffff', 0.72));
    const dirLight = new THREE.DirectionalLight('#ffffff', 0.95);
    dirLight.position.set(22, 34, 18);
    dirLight.castShadow = true;
    scene.add(dirLight);
    const fillLight = new THREE.DirectionalLight('#bae6fd', 0.35);
    fillLight.position.set(-18, 12, -16);
    scene.add(fillLight);

    // Floor Grid
    const grid = new THREE.GridHelper(48, 48, '#94a3b8', '#cbd5e1');
    scene.add(grid);

    const pickables: THREE.Object3D[] = [];
    const group = new THREE.Group();
    scene.add(group);
    modelRef.current = { group, pickables };

    // Raycaster for hover + click-to-select sync with Estimate pane
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let downPos = { x: 0, y: 0 };

    const onPointerMove = (ev: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(pickables, false);
      if (hits.length > 0 && hits[0].object.userData?.label) {
        setHoverInfo(hits[0].object.userData.label);
        renderer.domElement.style.cursor = 'pointer';
      } else {
        setHoverInfo(null);
        renderer.domElement.style.cursor = 'grab';
      }
    };

    const onPointerDown = (ev: PointerEvent) => {
      downPos = { x: ev.clientX, y: ev.clientY };
    };

    const onPointerUp = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - downPos.x, ev.clientY - downPos.y) > 4) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(pickables, false);
      if (hits.length > 0 && hits[0].object.userData?.shapeId) {
        selectShape(hits[0].object.userData.shapeId);
      }
    };

    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);

    controlsResetRef.current = () => controls.reset();

    const onResize = () => {
      if (!container) return;
      const w = Math.max(300, container.clientWidth);
      const h = Math.max(240, container.clientHeight);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    const resizeObs = new ResizeObserver(onResize);
    resizeObs.observe(container);

    let raf = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(raf);
      resizeObs.disconnect();
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      controls.dispose();
      grid.geometry.dispose();
      grid.material.dispose();
      dirLight.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      modelRef.current = null;
      controlsResetRef.current = null;
    };
  }, []);

  useEffect(() => {
    controlsResetRef.current?.();
  }, [activePlan?.id]);

  useEffect(() => {
    if (!modelRef.current) return;
    const { group, pickables } = modelRef.current;
    const visibleLayerNames = new Set(
      (activePlan?.layers ?? []).filter((l) => l.visible).map((l) => l.name)
    );

    // 1. Render imported IFC BIM 3D solids if active plan contains ifcElements
    const ifcList: IfcElementGeom[] = activePlan?.ifcElements ?? [];
    if (ifcList.length > 0) {
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const el of ifcList) {
        minX = Math.min(minX, el.xM);
        maxX = Math.max(maxX, el.xM + el.widthM);
        minY = Math.min(minY, el.yM);
        maxY = Math.max(maxY, el.yM + el.depthM);
      }
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;

      for (const el of ifcList) {
        if (visibleLayerNames.size > 0 && !visibleLayerNames.has(el.level)) continue;
        const w = Math.max(0.08, el.widthM);
        const d = Math.max(0.08, el.depthM);
        const h = Math.max(0.08, el.heightM);
        const geom = new THREE.BoxGeometry(w, h, d);
        const mat = new THREE.MeshStandardMaterial({
          color: el.color || '#2563eb',
          transparent: xrayMode || el.ifcClass === 'IfcWindow' || el.ifcClass === 'IfcSpace',
          opacity: el.ifcClass === 'IfcWindow' ? 0.45 : xrayMode ? 0.55 : 0.88,
          roughness: 0.55,
          metalness: 0.08,
        });
        const mesh = new THREE.Mesh(geom, mat);
        mesh.position.set(el.xM - cx + w / 2, el.zM + h / 2, el.yM - cy + d / 2);
        mesh.userData = {
          kind: 'ifc',
          shapeId: shapes.find((s) => s.name === el.name || s.ifcLevel === el.level && s.name.includes(el.name))?.id ?? null,
          label: `${el.ifcClass}: ${el.name} [${el.level}] · ${formatNumber(el.areaM2)} m² · ${formatNumber(el.volumeM3)} m³`,
        };
        const edges = new THREE.EdgesGeometry(geom);
        const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: '#0f172a', transparent: true, opacity: 0.25 }));
        mesh.add(line);
        group.add(mesh);
        pickables.push(mesh);
      }
    }

    // 2. Render 2D TakeoffShapes extruded into 3D space
    const scaleRatio = activePlan?.scaleRatio ?? 28;
    const renderShapes = isolateSelected && selectedShapeId
      ? shapes.filter((s) => s.id === selectedShapeId)
      : shapes;

    const sheetCenterX = 400;
    const sheetCenterY = 270;
    const toWorldXZ = (pt: { x: number; y: number }) => ({
      x: (pt.x - sheetCenterX) / scaleRatio,
      z: (pt.y - sheetCenterY) / scaleRatio,
    });

    for (const shp of renderShapes) {
      if (shp.hidden || shp.points.length === 0) continue;
      const isSelected = shp.id === selectedShapeId;
      const baseColor = new THREE.Color(isSelected ? '#f59e0b' : shp.color);

      if (shp.resultType.includes('Count')) {
        for (const p of shp.points) {
          const wp = toWorldXZ(p);
          const geom = new THREE.CylinderGeometry(0.18, 0.18, 1.4, 16);
          const mat = new THREE.MeshStandardMaterial({
            color: baseColor,
            emissive: isSelected ? new THREE.Color('#d97706') : new THREE.Color('#000000'),
            emissiveIntensity: isSelected ? 0.3 : 0,
          });
          const mesh = new THREE.Mesh(geom, mat);
          mesh.position.set(wp.x, 0.7, wp.z);
          mesh.userData = {
            shapeId: shp.id,
            label: `${shp.name} (${shp.resultType}) — ${shp.points.length} No.`,
          };
          group.add(mesh);
          pickables.push(mesh);
        }
        continue;
      }

      if (shp.closed && (shp.resultType === 'Area' || shp.resultType === 'Volume') && shp.points.length >= 3) {
        const shape2d = new THREE.Shape();
        const first = toWorldXZ(shp.points[0]);
        shape2d.moveTo(first.x, -first.z);
        for (let i = 1; i < shp.points.length; i++) {
          const wp = toWorldXZ(shp.points[i]);
          shape2d.lineTo(wp.x, -wp.z);
        }
        shape2d.closePath();

        const depthM = Math.max(0.08, (shp.depthMm ?? 180) / 1000);
        const geom = new THREE.ExtrudeGeometry(shape2d, { depth: depthM, bevelEnabled: false });
        geom.rotateX(-Math.PI / 2);
        const mat = new THREE.MeshStandardMaterial({
          color: baseColor,
          transparent: true,
          opacity: isSelected ? 0.92 : xrayMode ? 0.45 : 0.76,
          roughness: 0.6,
        });
        const mesh = new THREE.Mesh(geom, mat);
        mesh.position.y = 0.02;
        mesh.userData = {
          shapeId: shp.id,
          label: `${shp.name} (${shp.resultType})`,
        };
        const edges = new THREE.EdgesGeometry(geom);
        mesh.add(new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: isSelected ? '#0f172a' : shp.color })));
        group.add(mesh);
        pickables.push(mesh);
        continue;
      }

      // Vertical walls, trenches, or lengths
      const wallHeight =
        shp.resultType.includes('Vertical')
          ? Math.max(0.25, (shp.heightMm ?? 2700) / 1000)
          : shp.resultType === 'Volume by Length'
          ? Math.max(0.15, (shp.depthMm ?? 300) / 1000)
          : 0.28;
      const wallThick =
        shp.resultType === 'Volume by Length'
          ? Math.max(0.12, (shp.trenchWidthMm ?? 450) / 1000)
          : 0.16;

      const pts = shp.closed ? [...shp.points, shp.points[0]] : shp.points;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = toWorldXZ(pts[i]);
        const b = toWorldXZ(pts[i + 1]);
        const segLen = Math.hypot(b.x - a.x, b.z - a.z);
        if (segLen < 0.02) continue;
        const angle = Math.atan2(b.z - a.z, b.x - a.x);

        const geom = new THREE.BoxGeometry(segLen, wallHeight, wallThick);
        const mat = new THREE.MeshStandardMaterial({
          color: baseColor,
          transparent: true,
          opacity: isSelected ? 0.92 : xrayMode ? 0.45 : 0.82,
        });
        const mesh = new THREE.Mesh(geom, mat);
        mesh.position.set((a.x + b.x) / 2, wallHeight / 2, (a.z + b.z) / 2);
        mesh.rotation.y = -angle;
        mesh.userData = {
          shapeId: shp.id,
          label: `${shp.name} (${shp.resultType}) · H=${wallHeight.toFixed(2)}m`,
        };
        const edges = new THREE.EdgesGeometry(geom);
        mesh.add(new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: '#0f172a', transparent: true, opacity: 0.35 })));
        group.add(mesh);
        pickables.push(mesh);
      }
    }

    return () => {
      group.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
          object.geometry.dispose();
          object.material.dispose();
        }
      });
      group.clear();
      pickables.length = 0;
    };
  }, [activePlan, shapes, selectedShapeId, isolateSelected, xrayMode]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={mountRef} style={{ width: '100%', height: '100%' }} />
      <div
        style={{
          position: 'absolute',
          top: 44,
          left: 10,
          display: 'flex',
          gap: 6,
          zIndex: 8,
        }}
      >
        <button
          className="vp-tool-btn"
          style={{ background: '#ffffffea', border: '1px solid var(--border-main)' }}
          onClick={() => controlsResetRef.current?.()}
        >
          Reset Camera
        </button>
        <button
          className={`vp-tool-btn ${xrayMode ? 'active' : ''}`}
          style={{ background: xrayMode ? undefined : '#ffffffea', border: '1px solid var(--border-main)' }}
          onClick={() => setXrayMode((v) => !v)}
        >
          X-Ray BIM
        </button>
      </div>
      {hoverInfo && (
        <div
          style={{
            position: 'absolute',
            bottom: 34,
            left: 10,
            background: 'rgba(15, 23, 42, 0.9)',
            color: '#fff',
            padding: '4px 10px',
            borderRadius: 4,
            fontSize: 11,
            pointerEvents: 'none',
            zIndex: 10,
          }}
        >
          {hoverInfo}
        </div>
      )}
    </div>
  );
};
