import React, { useEffect, useState } from 'react';
import {
  Briefcase,
  ChevronDown,
  HelpCircle,
  KeyRound,
  Save,
  Settings,
  X,
  Undo2,
  Redo2,
  Layers,
} from 'lucide-react';
import {
  INITIAL_COMPANIES,
  INITIAL_CONSTANTS,
  INITIAL_CONTACTS,
  INITIAL_FOLDERS,
  INITIAL_GROUPING_CODES,
  INITIAL_JOBS,
  INITIAL_OPTIONS,
  INITIAL_PROJECTS,
} from './data/mockCubitData';
import type {
  ClientCompany,
  ClientContact,
  ConstantEntry,
  CubitOptionsState,
  EstimateRow,
  FolderNode,
  GroupingCodeDef,
  JobRecord,
  PlanDocument,
  ProjectNode,
  TakeoffShape,
} from './types/cubit';
import {
  checkEngineHealth,
  loadWorkspaceState,
  saveWorkspaceState,
} from './services/engineClient';
import { JobManagerView } from './components/jobManager/JobManagerView';
import { JobWorkspace } from './components/workspace/JobWorkspace';
import { OptionsModal } from './components/modals/OptionsModal';
import { ClientManagerModal } from './components/modals/ClientManagerModal';
import { GroupingCodesModal } from './components/modals/GroupingCodesModal';

interface JobHistorySnapshot {
  rows: EstimateRow[];
  shapes: TakeoffShape[];
  plans: PlanDocument[];
}

export function App() {
  const [projects, setProjects] = useState<ProjectNode[]>(INITIAL_PROJECTS);
  const [folders, setFolders] = useState<FolderNode[]>(INITIAL_FOLDERS);
  const [jobs, setJobs] = useState<JobRecord[]>(INITIAL_JOBS);
  const [companies, setCompanies] = useState<ClientCompany[]>(INITIAL_COMPANIES);
  const [contacts, setContacts] = useState<ClientContact[]>(INITIAL_CONTACTS);
  const [constants, setConstants] = useState<ConstantEntry[]>(INITIAL_CONSTANTS);
  const [groupingCodes, setGroupingCodes] = useState<GroupingCodeDef[]>(INITIAL_GROUPING_CODES);
  const [options, setOptions] = useState<CubitOptionsState>(INITIAL_OPTIONS);
  const [engineConnected, setEngineConnected] = useState(false);
  const [dbHydrated, setDbHydrated] = useState(false);

  // Navigation: 'jobManager' or an open jobId
  const [openJobIds, setOpenJobIds] = useState<string[]>(['job-1']);
  const [activeScreen, setActiveScreen] = useState<'jobManager' | string>('job-1');

  const [ribbonCollapsed, setRibbonCollapsed] = useState(false);
  const [showKeytips, setShowKeytips] = useState(false);
  const [appMenuOpen, setAppMenuOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [clientManagerOpen, setClientManagerOpen] = useState(false);
  const [groupingCodesOpen, setGroupingCodesOpen] = useState(false);
  const [licenseModalOpen, setLicenseModalOpen] = useState(false);
  const [helpModalOpen, setHelpModalOpen] = useState(false);

  const [pinnedQat, setPinnedQat] = useState<{ id: string; label: string }[]>([]);
  const [historyMap, setHistoryMap] = useState<
    Record<string, { past: JobHistorySnapshot[]; future: JobHistorySnapshot[] }>
  >({});
  const [toast, setToast] = useState<string | null>(null);

  const notify = (msg: string) => {
    setToast(msg);
  };

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  // Connect to CobitX SQLite + DuckDB Python Engine & hydrate persisted workspace state
  useEffect(() => {
    let active = true;
    (async () => {
      const health = await checkEngineHealth();
      if (!active) return;
      if (health) {
        setEngineConnected(true);
        const persisted = await loadWorkspaceState();
        if (!active) return;
        if (persisted && Array.isArray(persisted.jobs) && persisted.jobs.length > 0) {
          setProjects(persisted.projects ?? INITIAL_PROJECTS);
          setFolders(persisted.folders ?? INITIAL_FOLDERS);
          setJobs(persisted.jobs);
          setCompanies(persisted.companies ?? INITIAL_COMPANIES);
          setContacts(persisted.contacts ?? INITIAL_CONTACTS);
          setConstants(persisted.constants ?? INITIAL_CONSTANTS);
          setGroupingCodes(persisted.groupingCodes ?? INITIAL_GROUPING_CODES);
          if (persisted.options) setOptions(persisted.options);
        } else {
          await saveWorkspaceState({
            projects: INITIAL_PROJECTS,
            folders: INITIAL_FOLDERS,
            jobs: INITIAL_JOBS,
            companies: INITIAL_COMPANIES,
            contacts: INITIAL_CONTACTS,
            constants: INITIAL_CONSTANTS,
            groupingCodes: INITIAL_GROUPING_CODES,
            options: INITIAL_OPTIONS,
          });
        }
      }
      if (active) setDbHydrated(true);
    })();
    return () => {
      active = false;
    };
  }, []);

  // Auto-persist workspace changes to SQLite + DuckDB backend
  useEffect(() => {
    if (!dbHydrated || !engineConnected) return;
    const timer = setTimeout(() => {
      saveWorkspaceState({
        projects,
        folders,
        jobs,
        companies,
        contacts,
        constants,
        groupingCodes,
        options,
      });
    }, 600);
    return () => clearTimeout(timer);
  }, [
    dbHydrated,
    engineConnected,
    projects,
    folders,
    jobs,
    companies,
    contacts,
    constants,
    groupingCodes,
    options,
  ]);

  const handleUpdateJob = (jobId: string, patch: Partial<JobRecord>, recordHistory = true) => {
    const tracksHistory =
      recordHistory &&
      (patch.rows !== undefined || patch.shapes !== undefined || patch.plans !== undefined);
    if (tracksHistory) {
      const target = jobs.find((j) => j.id === jobId);
      if (target) {
        const snap: JobHistorySnapshot = {
          rows: target.rows,
          shapes: target.shapes,
          plans: target.plans,
        };
        setHistoryMap((hm) => {
          const cur = hm[jobId] ?? { past: [], future: [] };
          return {
            ...hm,
            [jobId]: {
              past: [...cur.past, snap].slice(-40),
              future: [],
            },
          };
        });
      }
    }
    setJobs((prev) =>
      prev.map((j) => {
        if (j.id !== jobId) return j;
        return {
          ...j,
          ...patch,
          lastUpdated: new Date().toISOString().slice(0, 16).replace('T', ' '),
        };
      })
    );
  };

  const handleUndo = () => {
    if (activeScreen === 'jobManager') return;
    const job = jobs.find((j) => j.id === activeScreen);
    if (!job) return;
    const entry = historyMap[job.id];
    if (!entry || entry.past.length === 0) {
      notify('Nothing to undo.');
      return;
    }
    const prevSnapshot = entry.past[entry.past.length - 1];
    const currentSnapshot: JobHistorySnapshot = {
      rows: job.rows,
      shapes: job.shapes,
      plans: job.plans,
    };
    setHistoryMap((prev) => ({
      ...prev,
      [job.id]: {
        past: entry.past.slice(0, -1),
        future: [currentSnapshot, ...entry.future].slice(0, 40),
      },
    }));
    handleUpdateJob(job.id, prevSnapshot, false);
    notify('Undid last change.');
  };

  const handleRedo = () => {
    if (activeScreen === 'jobManager') return;
    const job = jobs.find((j) => j.id === activeScreen);
    if (!job) return;
    const entry = historyMap[job.id];
    if (!entry || entry.future.length === 0) {
      notify('Nothing to redo.');
      return;
    }
    const nextSnapshot = entry.future[0];
    const currentSnapshot: JobHistorySnapshot = {
      rows: job.rows,
      shapes: job.shapes,
      plans: job.plans,
    };
    setHistoryMap((prev) => ({
      ...prev,
      [job.id]: {
        past: [...entry.past, currentSnapshot].slice(-40),
        future: entry.future.slice(1),
      },
    }));
    handleUpdateJob(job.id, nextSnapshot, false);
    notify('Redid change.');
  };

  // Global Cubit Shortcuts: Ctrl+F1 (Ribbon), F10 (Keytips), F1 (Help), Ctrl+Z (Undo), Ctrl+Y (Redo)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

      if (e.ctrlKey && e.key === 'F1') {
        e.preventDefault();
        setRibbonCollapsed((v) => !v);
      } else if (e.key === 'F10') {
        e.preventDefault();
        setShowKeytips((v) => !v);
      } else if (e.key === 'F1') {
        e.preventDefault();
        setHelpModalOpen(true);
      } else if (!isInput && (e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        handleUndo();
      } else if (
        !isInput &&
        (e.ctrlKey || e.metaKey) &&
        (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))
      ) {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const handleOpenJob = (jobId: string) => {
    setOpenJobIds((prev) => (prev.includes(jobId) ? prev : [...prev, jobId]));
    setActiveScreen(jobId);
  };

  const handleCloseOpenJob = (e: React.MouseEvent, jobId: string) => {
    e.stopPropagation();
    setOpenJobIds((prev) => {
      const next = prev.filter((id) => id !== jobId);
      if (activeScreen === jobId) {
        setActiveScreen(next[next.length - 1] ?? 'jobManager');
      }
      return next;
    });
  };

  const handleCreateProject = (name: string) => {
    const proj: ProjectNode = {
      id: `proj-${Date.now()}`,
      name,
      description: '',
      builder: '',
      startDate: new Date().toISOString().slice(0, 10),
      useAsTemplate: false,
      status: 'Open',
      freezeStates: ['None'],
      siteAddress: { street: '', suburb: '', state: 'NSW', postcode: '', country: 'Australia' },
      companyId: null,
      contactId: null,
    };
    setProjects((prev) => [...prev, proj]);
    notify(`Created Project "${name}".`);
  };

  const handleCreateFolder = (projectId: string, name: string) => {
    const fold: FolderNode = { id: `fold-${Date.now()}`, projectId, name };
    setFolders((prev) => [...prev, fold]);
    notify(`Created Folder "${name}".`);
  };

  const handleCreateJob = (opts: {
    kind: 'Job' | 'PriceList';
    projectId: string | null;
    name: string;
    templateId?: string;
    removeQuantities?: boolean;
  }) => {
    const tpl = opts.templateId ? jobs.find((j) => j.id === opts.templateId) : undefined;
    const rows = tpl
      ? tpl.rows.map((r) => ({
          ...r,
          quantity: opts.removeQuantities ? 0 : r.quantity,
          calcRows: opts.removeQuantities ? [] : r.calcRows,
        }))
      : [];

    const newJob: JobRecord = {
      id: `${opts.kind === 'PriceList' ? 'pl' : 'job'}-${Date.now()}`,
      kind: opts.kind,
      projectId: opts.projectId,
      folderId: null,
      name: opts.name,
      description: '',
      builder: '',
      startDate: new Date().toISOString().slice(0, 10),
      lastUpdated: new Date().toISOString().slice(0, 16).replace('T', ' '),
      useAsTemplate: opts.kind === 'PriceList',
      status: 'Open',
      freezeStates: ['None'],
      siteAddress: { street: '', suburb: '', state: 'NSW', postcode: '', country: 'Australia' },
      companyId: null,
      contactId: null,
      accountManager: 'Estimator',
      markupPct: options.defaultMarkupPct,
      salesTaxPct: options.defaultTaxPct,
      rows,
      plans: tpl ? tpl.plans : [],
      shapes: tpl && !opts.removeQuantities ? tpl.shapes : [],
    };
    setJobs((prev) => [...prev, newJob]);
    notify(`Created ${opts.kind === 'PriceList' ? 'Price List' : 'Job'} "${opts.name}".`);
  };

  const handleDeleteItem = (kind: 'Project' | 'Folder' | 'Job', id: string) => {
    if (kind === 'Project') {
      setProjects((p) => p.filter((x) => x.id !== id));
      setFolders((f) => f.filter((x) => x.projectId !== id));
      setJobs((j) => j.filter((x) => x.projectId !== id));
    } else if (kind === 'Folder') {
      setFolders((f) => f.filter((x) => x.id !== id));
      setJobs((j) => j.filter((x) => x.folderId !== id));
    } else {
      setJobs((j) => j.filter((x) => x.id !== id));
      setOpenJobIds((o) => o.filter((x) => x !== id));
    }
    notify(`Deleted ${kind}.`);
  };

  const handleDuplicateJob = (jobId: string, targetProjectId: string | null) => {
    const src = jobs.find((j) => j.id === jobId);
    if (!src) return;
    const copy: JobRecord = {
      ...src,
      id: `job-${Date.now()}`,
      name: `${src.name} (Copy)`,
      projectId: src.kind === 'Job' ? targetProjectId ?? src.projectId : null,
      folderId: null,
      lastUpdated: new Date().toISOString().slice(0, 16).replace('T', ' '),
    };
    setJobs((prev) => [...prev, copy]);
    notify(`Pasted "${copy.name}".`);
  };

  const handleMergeJobs = (jobIds: string[], newName: string, includePlans: boolean) => {
    const selected = jobs.filter((j) => jobIds.includes(j.id));
    if (selected.length < 2) return;
    const merged: JobRecord = {
      ...selected[0],
      id: `job-${Date.now()}`,
      name: newName,
      rows: selected.flatMap((j) => j.rows),
      plans: includePlans ? selected.flatMap((j) => j.plans) : [],
      shapes: includePlans ? selected.flatMap((j) => j.shapes) : [],
      lastUpdated: new Date().toISOString().slice(0, 16).replace('T', ' '),
    };
    setJobs((prev) => [...prev, merged]);
    notify(`Merged ${selected.length} jobs into "${newName}".`);
  };

  const handlePinToQat = (id: string, label: string) => {
    setPinnedQat((prev) =>
      prev.some((x) => x.id === id)
        ? prev.filter((x) => x.id !== id)
        : [...prev, { id, label }]
    );
    notify(`Updated Quick Access Toolbar (${label}).`);
  };

  const handleCreateGroupedJob = (sourceJob: JobRecord) => {
    const itemGroups = new Map<string, EstimateRow[]>();
    for (const r of sourceJob.rows) {
      if (r.rowType !== 'Item') continue;
      const gc = r.groupingCode || 'UNASSIGNED';
      if (!itemGroups.has(gc)) itemGroups.set(gc, []);
      itemGroups.get(gc)!.push(r);
    }
    const groupedRows: EstimateRow[] = [];
    Array.from(itemGroups.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([gc, items], idx) => {
        const tradeId = `grp-tr-${Date.now()}-${idx}`;
        const gcDef = groupingCodes.find((g) => g.code === gc);
        groupedRows.push({
          id: tradeId,
          parentId: null,
          rowType: 'Trade',
          code: gc,
          description: gcDef ? gcDef.description : `GROUP: ${gc}`,
          quantity: 0,
          unit: '',
          factor: 1,
          rate: 0,
          markupPct: 0,
          pricingMode: 'INCL',
          groupingCode: gc,
          calcRows: [],
          rateRows: [],
        });
        items.forEach((it, j) => {
          groupedRows.push({
            ...it,
            id: `grp-it-${Date.now()}-${idx}-${j}`,
            parentId: tradeId,
          });
        });
      });

    const newJobId = `job-grp-${Date.now()}`;
    const groupedJob: JobRecord = {
      ...sourceJob,
      id: newJobId,
      name: `${sourceJob.name} (Grouped by Code)`,
      rows: groupedRows,
      lastUpdated: new Date().toISOString().slice(0, 16).replace('T', ' '),
    };
    setJobs((prev) => [...prev, groupedJob]);
    setOpenJobIds((prev) => [...prev, newJobId]);
    setActiveScreen(newJobId);
    notify(`Created Grouped Job "${groupedJob.name}".`);
  };

  const handleDatabaseBackup = () => {
    const payload = {
      format: 'cobitx-backup-v1',
      exportedAt: new Date().toISOString(),
      state: { projects, folders, jobs, companies, contacts, constants, groupingCodes, options },
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cobitx-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    notify('Database Backup downloaded (.json).');
  };

  const activeJob =
    activeScreen !== 'jobManager' ? jobs.find((j) => j.id === activeScreen) ?? null : null;
  const priceLists = jobs.filter((j) => j.kind === 'PriceList');

  return (
    <div className="cobit-shell" data-theme={options.uiTheme}>
      {/* Top Quick Access Toolbar & Multi-Job Switcher */}
      <header className="qat-bar">
        <div className="qat-left">
          <div className="qat-brand">
            <Layers size={15} />
            <span>COBITX</span>
          </div>

          <button
            className={`qat-btn ${activeScreen === 'jobManager' ? 'active' : ''}`}
            onClick={() => setActiveScreen('jobManager')}
            title="Switch to Job Manager (keeps open jobs running)"
          >
            <Briefcase size={13} />
            <span>Job Manager</span>
          </button>

          <button className="qat-btn" onClick={handleUndo} title="Undo (Ctrl+Z)">
            <Undo2 size={13} />
          </button>
          <button className="qat-btn" onClick={handleRedo} title="Redo (Ctrl+Y)">
            <Redo2 size={13} />
          </button>

          {pinnedQat.map((btn) => (
            <button
              key={btn.id}
              className="qat-btn"
              onContextMenu={(e) => {
                e.preventDefault();
                handlePinToQat(btn.id, btn.label);
              }}
              onClick={() => notify(`QAT: ${btn.label}`)}
              title="Right-click to Remove from Quick Access Toolbar"
            >
              <span>{btn.label}</span>
            </button>
          ))}
        </div>

        <div className="qat-title">
          {activeJob
            ? `CobitX Estimating — ${activeJob.name}`
            : 'CobitX Estimating — Job Manager'}
          <span
            style={{
              marginLeft: 10,
              fontSize: 9.5,
              padding: '1px 6px',
              borderRadius: 10,
              background: engineConnected ? 'rgba(22, 163, 74, 0.25)' : 'rgba(148, 163, 184, 0.25)',
              color: engineConnected ? '#bbf7d0' : '#e2e8f0',
            }}
            title="SQLite + DuckDB + MCP Engine status"
          >
            {engineConnected ? 'Local engine online' : 'Local Memory Mode'}
          </span>
        </div>

        <div className="qat-right">
          <div className="qat-job-pills">
            {openJobIds.map((jid) => {
              const j = jobs.find((x) => x.id === jid);
              if (!j) return null;
              return (
                <div
                  key={jid}
                  className={`qat-job-pill ${activeScreen === jid ? 'active' : ''}`}
                  onClick={() => setActiveScreen(jid)}
                  style={{ cursor: 'pointer' }}
                >
                  <span style={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {j.name}
                  </span>
                  <span
                    className="qat-job-pill-close"
                    onClick={(e) => handleCloseOpenJob(e, jid)}
                    title="Close Job Tab"
                  >
                    <X size={11} />
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </header>

      {/* Application Button Bar Overlay Anchor */}
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        <button
          className="app-menu-btn"
          style={{ position: 'absolute', top: 0, left: 0, zIndex: 25 }}
          onClick={() => setAppMenuOpen((v) => !v)}
        >
          <span>{activeJob ? 'Job' : 'Cubit'}</span>
          <ChevronDown size={12} />
        </button>

        {/* Offset Ribbon Tabs Row slightly on left for Application Button */}
        <style>{`.ribbon-tabs-left { padding-left: 78px; }`}</style>

        {activeJob ? (
          <JobWorkspace
            key={activeJob.id}
            job={activeJob}
            priceLists={priceLists}
            options={options}
            constants={constants}
            onUpdateConstants={setConstants}
            groupingCodes={groupingCodes}
            onUpdateGroupingCodes={setGroupingCodes}
            onCreateGroupedJob={handleCreateGroupedJob}
            ribbonCollapsed={ribbonCollapsed}
            onToggleRibbon={() => setRibbonCollapsed((v) => !v)}
            showKeytips={showKeytips}
            onUpdateJob={handleUpdateJob}
            onPinToQat={handlePinToQat}
            onOpenSettings={() => setOptionsOpen(true)}
            onOpenHelp={() => setHelpModalOpen(true)}
            onNotify={notify}
          />
        ) : (
          <JobManagerView
            projects={projects}
            folders={folders}
            jobs={jobs}
            companies={companies}
            contacts={contacts}
            ribbonCollapsed={ribbonCollapsed}
            onToggleRibbon={() => setRibbonCollapsed((v) => !v)}
            showKeytips={showKeytips}
            onOpenJob={handleOpenJob}
            onCreateProject={handleCreateProject}
            onCreateFolder={handleCreateFolder}
            onCreateJob={handleCreateJob}
            onUpdateJob={handleUpdateJob}
            onUpdateProject={(pid, patch) =>
              setProjects((prev) => prev.map((p) => (p.id === pid ? { ...p, ...patch } : p)))
            }
            onDeleteItem={handleDeleteItem}
            onDuplicateJob={handleDuplicateJob}
            onMergeJobs={handleMergeJobs}
            onImportJobArchive={(importedJob) => {
              const attached: JobRecord = {
                ...importedJob,
                projectId: importedJob.kind === 'Job' ? importedJob.projectId ?? projects[0]?.id ?? null : null,
              };
              setJobs((prev) => [...prev, attached]);
              notify(`Imported "${attached.name}" (${attached.rows.length} rows).`);
            }}
            onGroupJob={handleCreateGroupedJob}
            onOpenGroupingCodes={() => setGroupingCodesOpen(true)}
            onOpenClientManager={() => setClientManagerOpen(true)}
            onNotify={notify}
          />
        )}
      </div>

      {/* Application Menu Popover */}
      {appMenuOpen && (
        <>
          <div className="app-menu-backdrop" onClick={() => setAppMenuOpen(false)} />
          <div className="app-menu-popover">
            <button
              className="app-menu-item"
              onClick={() => {
                setActiveScreen('jobManager');
                setAppMenuOpen(false);
              }}
            >
              <span className="app-menu-item-left">
                <Briefcase size={14} color="var(--brand-blue)" /> Job Manager
              </span>
            </button>
            <button
              className="app-menu-item"
              onClick={() => {
                handleDatabaseBackup();
                setAppMenuOpen(false);
              }}
            >
              <span className="app-menu-item-left">
                <Save size={14} color="var(--brand-blue)" /> Database Backup (Download JSON)
              </span>
            </button>
            <div className="app-menu-sep" />
            <button
              className="app-menu-item"
              onClick={() => {
                setOptionsOpen(true);
                setAppMenuOpen(false);
              }}
            >
              <span className="app-menu-item-left">
                <Settings size={14} color="var(--brand-blue)" /> CobitX Settings
              </span>
            </button>
            <button
              className="app-menu-item"
              onClick={() => {
                setLicenseModalOpen(true);
                setAppMenuOpen(false);
              }}
            >
              <span className="app-menu-item-left">
                <KeyRound size={14} color="#0d9488" /> License Manager
              </span>
            </button>
            <div className="app-menu-sep" />
            <button
              className="app-menu-item"
              onClick={() => {
                setHelpModalOpen(true);
                setAppMenuOpen(false);
              }}
            >
              <span className="app-menu-item-left">
                <HelpCircle size={14} /> Shortcuts &amp; Help
              </span>
              <span className="mono" style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>F1</span>
            </button>
          </div>
        </>
      )}

      {/* Modals */}
      {optionsOpen && (
        <OptionsModal
          options={options}
          onSave={(next) => {
            setOptions(next);
            notify('CobitX Settings updated.');
          }}
          onClose={() => setOptionsOpen(false)}
        />
      )}

      {clientManagerOpen && (
        <ClientManagerModal
          companies={companies}
          contacts={contacts}
          codeLabel={options.companyCodeLabel}
          onAddCompany={(comp) => setCompanies((prev) => [...prev, comp])}
          onAddContact={(cont) => setContacts((prev) => [...prev, cont])}
          onSetPrimaryContact={(compId, contId) =>
            setContacts((prev) =>
              prev.map((c) =>
                c.companyId === compId ? { ...c, isPrimary: c.id === contId } : c
              )
            )
          }
          onClose={() => setClientManagerOpen(false)}
        />
      )}

      {groupingCodesOpen && (
        <GroupingCodesModal
          groupingCodes={groupingCodes}
          rows={jobs.find((j) => j.kind === 'Job')?.rows ?? []}
          selectedRow={null}
          onSaveCodes={(next) => {
            setGroupingCodes(next);
            notify(`Saved ${next.length} Grouping Code(s).`);
          }}
          onAssignRowCode={() => undefined}
          onGenerateGroupedJob={() => {
            const firstJob = jobs.find((j) => j.kind === 'Job');
            if (firstJob) handleCreateGroupedJob(firstJob);
            setGroupingCodesOpen(false);
          }}
          onClose={() => setGroupingCodesOpen(false)}
        />
      )}

      {licenseModalOpen && (
        <div className="modal-backdrop" onClick={() => setLicenseModalOpen(false)}>
          <div className="modal-window" style={{ width: 420 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span>CobitX License Manager</span>
              <button className="modal-close" onClick={() => setLicenseModalOpen(false)}>
                <X size={14} />
              </button>
            </div>
            <div className="modal-body">
              <div className="form-grid" style={{ gridTemplateColumns: '120px 1fr' }}>
                <span className="form-label">Edition:</span>
                <strong>CobitX Enterprise + AI Estimating</strong>
                <span className="form-label">Installation Type:</span>
                <span>Standalone Desktop (.exe)</span>
                <span className="form-label">BIM Takeoff Module:</span>
                <span style={{ color: 'var(--accent-green)', fontWeight: 600 }}>Enabled</span>
                <span className="form-label">MCP Server/Client:</span>
                <span style={{ color: 'var(--accent-green)', fontWeight: 600 }}>
                  {options.mcpServerEnabled ? `Enabled (Port ${options.mcpServerPort})` : 'Disabled'}
                </span>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-primary" onClick={() => setLicenseModalOpen(false)}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {helpModalOpen && (
        <div className="modal-backdrop" onClick={() => setHelpModalOpen(false)}>
          <div className="modal-window" style={{ width: 520 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span>CobitX — Keyboard &amp; Mouse Shortcuts (Cubit Parity)</span>
              <button className="modal-close" onClick={() => setHelpModalOpen(false)}>
                <X size={14} />
              </button>
            </div>
            <div className="modal-body" style={{ fontSize: 11.5 }}>
              <table className="cubit-table">
                <thead>
                  <tr>
                    <th style={{ width: 130 }}>Shortcut</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['Ctrl + 1 .. 7', 'Select / Polyline / Auto Select / Rectangle / Line / Count / Ruler'],
                    ['J / Right Click', 'Close Shape / Finish Shape'],
                    ['F7 / F8 / F9', 'Toggle Phantom Line / Ortho Angle / Focus Calculation Sheet'],
                    ['Ctrl + T / H / I', 'Insert Trade / Heading / Item'],
                    ['Ctrl + < / >', 'Indent / Unindent selected Estimate row'],
                    ['Ctrl + L', 'Lock / Unlock selected Trade section'],
                    ['Shift + F4', 'Copy Down Relative reference on Estimate row'],
                    ['I / E', 'Set selected Item pricing to INCL / EXCL'],
                    ['Ctrl + M', 'Toggle Flag on selected Estimate row'],
                    ['Ctrl + F1 / F10', 'Collapse Ribbon / Toggle Ribbon Keytips'],
                  ].map(([k, a]) => (
                    <tr key={k}>
                      <td className="mono" style={{ fontWeight: 600 }}>{k}</td>
                      <td>{a}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="modal-footer">
              <button className="btn-primary" onClick={() => setHelpModalOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Non-intrusive Status Notification */}
      {toast && (
        <div
          style={{
            position: 'fixed',
            bottom: 34,
            right: 16,
            zIndex: 300,
            background: '#0f172a',
            color: '#ffffff',
            padding: '7px 13px',
            borderRadius: 4,
            fontSize: 11.5,
            boxShadow: 'var(--shadow-md)',
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}

export default App;
