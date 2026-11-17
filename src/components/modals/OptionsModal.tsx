import React, { useEffect, useState } from 'react';
import { Play, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import type {
  CubitOptionsState,
  ImperialDisplayMode,
  McpServerConfig,
  UiThemeMode,
} from '../../types/cubit';
import {
  callMcpTool,
  checkEngineHealth,
  fetchMcpManifest,
  probeMcpConnection,
  type EngineHealth,
  type McpManifest,
} from '../../services/engineClient';

interface OptionsModalProps {
  options: CubitOptionsState;
  onSave: (next: CubitOptionsState) => void;
  onClose: () => void;
}

const demoEndpoints = new Map([
  ['mcp-1', 'http://localhost:48010/mcp'],
  ['mcp-2', 'https://pricing.suppliers.local/mcp'],
  ['mcp-3', 'npx @cobitx/mcp-xero-connector --org default'],
]);

type Probe = Awaited<ReturnType<typeof probeMcpConnection>>;

type OptionTab = 'General' | 'Interface' | 'Viewport' | 'Dimensions' | 'Reports' | 'AI' | 'MCP';

export const OptionsModal: React.FC<OptionsModalProps> = ({
  options,
  onSave,
  onClose,
}) => {
  const [tab, setTab] = useState<OptionTab>('General');
  const [draft, setDraft] = useState<CubitOptionsState>(options);
  const [newMcpName, setNewMcpName] = useState('');
  const [newMcpEndpoint, setNewMcpEndpoint] = useState('');
  const [newMcpTransport, setNewMcpTransport] = useState<'http' | 'stdio'>('http');
  const [newMcpCategory, setNewMcpCategory] = useState<McpServerConfig['category']>('SupplierPricing');
  const [mcpManifest, setMcpManifest] = useState<McpManifest | null>(null);
  const [engineHealth, setEngineHealth] = useState<EngineHealth | null>(null);
  const [selectedMcpTool, setSelectedMcpTool] = useState('cobitx_list_jobs');
  const [mcpToolArgsJson, setMcpToolArgsJson] = useState('{}');
  const [mcpOutput, setMcpOutput] = useState<string>('');
  const [probeResults, setProbeResults] = useState<Record<string, Probe>>({});
  const [testingId, setTestingId] = useState<string | null>(null);
  const [probeMessage, setProbeMessage] = useState<string>('');

  useEffect(() => {
    if ((tab === 'MCP' || tab === 'Reports') && !engineHealth) {
      checkEngineHealth().then((h) => {
        if (h) setEngineHealth(h);
      });
    }
    if (tab === 'MCP' && !mcpManifest) {
      fetchMcpManifest().then((m) => {
        if (m) setMcpManifest(m);
      });
    }
  }, [tab, mcpManifest, engineHealth]);

  const handleTestMcpServer = async (m: McpServerConfig) => {
    setTestingId(m.id);
    setProbeMessage(`Testing ${m.name}…`);
    try {
      const result = await probeMcpConnection(m.transport, m.endpointOrCommand);
      setProbeResults((previous) => ({ ...previous, [m.id]: result }));
      setProbeMessage(`${m.name} (${result.latencyMs} ms). ${result.detail}`);
    } catch (error) {
      setProbeResults((previous) => ({
        ...previous,
        [m.id]: { ok: false, status: 'Disconnected', latencyMs: 0, detail: String(error) },
      }));
      setProbeMessage(`Test failed. ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setTestingId(null);
    }
  };

  const handleRunBuiltInMcpTool = async () => {
    try {
      const parsedArgs = JSON.parse(mcpToolArgsJson || '{}');
      const res = await callMcpTool(selectedMcpTool, parsedArgs);
      setMcpOutput(JSON.stringify(res, null, 2));
    } catch (err) {
      setMcpOutput(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const tabs: OptionTab[] = [
    'General',
    'Interface',
    'Viewport',
    'Dimensions',
    'Reports',
    'AI',
    'MCP',
  ];

  const handleAddMcp = () => {
    if (!newMcpName.trim() || !newMcpEndpoint.trim()) return;
    const item: McpServerConfig = {
      id: `mcp-${Date.now()}`,
      name: newMcpName.trim(),
      transport: newMcpTransport,
      endpointOrCommand: newMcpEndpoint.trim(),
      category: newMcpCategory,
      enabled: true,
      status: 'Disconnected',
      toolsCount: 0,
      resourcesCount: 0,
    };
    setDraft({
      ...draft,
      mcpConnections: [...draft.mcpConnections, item],
    });
    setNewMcpName('');
    setNewMcpEndpoint('');
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-window"
        style={{ width: 680, height: 495 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <span>CobitX Settings</span>
          <button className="modal-close" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div
          style={{
            display: 'flex',
            gap: 2,
            background: 'var(--bg-header)',
            borderBottom: '1px solid var(--border-main)',
            padding: '4px 10px 0',
          }}
        >
          {tabs.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`jm-subtab ${tab === t ? 'active' : ''}`}
            >
              {t === 'AI' ? 'Plans / AI' : t === 'MCP' ? 'MCP Connections' : t}
            </button>
          ))}
        </div>

        <div className="modal-body" style={{ padding: 14 }}>
          {tab === 'General' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <fieldset style={{ border: '1px solid var(--border-main)', padding: 10 }}>
                <legend style={{ fontWeight: 600, fontSize: 11, padding: '0 4px' }}>
                  Plans &amp; PDF Import
                </legend>
                <div className="form-grid">
                  <span className="form-label">Import PDFs as:</span>
                  <select
                    className="form-select"
                    value={draft.importPdfDefault}
                    onChange={(e) =>
                      setDraft({ ...draft, importPdfDefault: e.target.value as 'Vector' | 'Raster' })
                    }
                  >
                    <option value="Vector">Vector (Paths &amp; Layers)</option>
                    <option value="Raster">Raster (Flat Image)</option>
                  </select>
                  <label className="form-checkbox-row">
                    <input
                      type="checkbox"
                      checked={draft.promptScalingOnInsert}
                      onChange={(e) =>
                        setDraft({ ...draft, promptScalingOnInsert: e.target.checked })
                      }
                    />
                    Prompt for scaling after insert
                  </label>
                </div>
              </fieldset>

              <fieldset style={{ border: '1px solid var(--border-main)', padding: 10 }}>
                <legend style={{ fontWeight: 600, fontSize: 11, padding: '0 4px' }}>
                  Default Adjustment, Client Code &amp; Sales Tax
                </legend>
                <div className="form-grid">
                  <span className="form-label">Company code name:</span>
                  <input
                    className="form-input"
                    value={draft.companyCodeLabel}
                    onChange={(e) => setDraft({ ...draft, companyCodeLabel: e.target.value })}
                  />
                  <span className="form-label">Default Markup (%):</span>
                  <input
                    type="number"
                    className="form-input"
                    value={draft.defaultMarkupPct}
                    onChange={(e) =>
                      setDraft({ ...draft, defaultMarkupPct: Number(e.target.value) || 0 })
                    }
                  />
                  <span className="form-label">Sales Tax / GST (%):</span>
                  <input
                    type="number"
                    className="form-input"
                    value={draft.defaultTaxPct}
                    onChange={(e) =>
                      setDraft({ ...draft, defaultTaxPct: Number(e.target.value) || 0 })
                    }
                  />
                </div>
              </fieldset>
            </div>
          )}

          {tab === 'Interface' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <fieldset style={{ border: '1px solid var(--border-main)', padding: 10 }}>
                <legend style={{ fontWeight: 600, fontSize: 11, padding: '0 4px' }}>
                  Skin &amp; Docking (Cubit v11+ Overhaul)
                </legend>
                <div className="form-grid">
                  <span className="form-label">Interface Theme:</span>
                  <select
                    className="form-select"
                    value={draft.uiTheme}
                    onChange={(e) =>
                      setDraft({ ...draft, uiTheme: e.target.value as UiThemeMode })
                    }
                  >
                    <option value="Light">Light Mode (Classic Buildsoft)</option>
                    <option value="Dark">Dark Mode (Slate)</option>
                    <option value="DesignerBlack">Designer Black (High Contrast CAD)</option>
                  </select>
                  <label className="form-checkbox-row">
                    <input
                      type="checkbox"
                      checked={draft.panesMovable}
                      onChange={(e) => setDraft({ ...draft, panesMovable: e.target.checked })}
                    />
                    Panes Movable &amp; Detachable (Dual Screen)
                  </label>
                  <label className="form-checkbox-row">
                    <input
                      type="checkbox"
                      checked={draft.panesCollapsible}
                      onChange={(e) => setDraft({ ...draft, panesCollapsible: e.target.checked })}
                    />
                    Panes Collapsible
                  </label>
                </div>
              </fieldset>

              <fieldset style={{ border: '1px solid var(--border-main)', padding: 10 }}>
                <legend style={{ fontWeight: 600, fontSize: 11, padding: '0 4px' }}>
                  Localisation &amp; Regional Settings
                </legend>
                <div className="form-grid">
                  <span className="form-label">Country / Region:</span>
                  <select
                    className="form-select"
                    value={draft.country}
                    onChange={(e) => setDraft({ ...draft, country: e.target.value })}
                  >
                    <option value="Australia">Australia (AUD / GST)</option>
                    <option value="New Zealand">New Zealand (NZD / GST)</option>
                    <option value="United Kingdom">United Kingdom (GBP / VAT)</option>
                    <option value="United States">United States (USD / Sales Tax)</option>
                    <option value="Canada">Canada (CAD / GST-HST)</option>
                  </select>
                  <span className="form-label">Language:</span>
                  <select
                    className="form-select"
                    value={draft.language}
                    onChange={(e) => setDraft({ ...draft, language: e.target.value })}
                  >
                    <option value="English">English</option>
                    <option value="French">Français</option>
                    <option value="Spanish">Español</option>
                  </select>
                </div>
              </fieldset>
            </div>
          )}

          {tab === 'Viewport' && (
            <fieldset style={{ border: '1px solid var(--border-main)', padding: 10 }}>
              <legend style={{ fontWeight: 600, fontSize: 11, padding: '0 4px' }}>
                Viewport &amp; Vector Snapping
              </legend>
              <div className="form-grid">
                <label className="form-checkbox-row">
                  <input
                    type="checkbox"
                    checked={draft.snappingEnabled}
                    onChange={(e) => setDraft({ ...draft, snappingEnabled: e.target.checked })}
                  />
                  Enable Snap Points on Vector Plans
                </label>
                <span className="form-label">Snap Point Colour:</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="color"
                    value={draft.snapColor}
                    onChange={(e) => setDraft({ ...draft, snapColor: e.target.value })}
                    style={{ width: 38, height: 24, border: '1px solid var(--border-main)' }}
                  />
                  <span className="mono">{draft.snapColor}</span>
                </div>
              </div>
            </fieldset>
          )}

          {tab === 'Dimensions' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <fieldset style={{ border: '1px solid var(--border-main)', padding: 10 }}>
                <legend style={{ fontWeight: 600, fontSize: 11, padding: '0 4px' }}>
                  Measurement Units &amp; Imperial Formats
                </legend>
                <div className="form-grid">
                  <span className="form-label">Default unit system:</span>
                  <select
                    className="form-select"
                    value={draft.defaultMeasurementUnit}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        defaultMeasurementUnit: e.target.value as 'Metric' | 'Imperial',
                      })
                    }
                  >
                    <option value="Metric">Metric (mm / m / m² / m³)</option>
                    <option value="Imperial">Imperial (in / ft / SF / CY)</option>
                  </select>
                  <span className="form-label">Imperial input format:</span>
                  <select
                    className="form-select"
                    value={draft.imperialDisplayMode}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        imperialDisplayMode: e.target.value as ImperialDisplayMode,
                      })
                    }
                  >
                    <option value="Decimal">Decimal Feet (12.50 ft)</option>
                    <option value="FIS">FIS — Feet-Inch-Sixths (12&apos; 6&quot; 3)</option>
                    <option value="FIF">FIF — Feet-Inch-Fractions (12&apos;-6 1/2&quot;)</option>
                  </select>
                </div>
              </fieldset>
              <fieldset style={{ border: '1px solid var(--border-main)', padding: 10 }}>
                <legend style={{ fontWeight: 600, fontSize: 11, padding: '0 4px' }}>
                  Default Dimensions (mm)
                </legend>
                <div className="form-grid">
                  <span className="form-label">Vertical height:</span>
                  <input
                    type="number"
                    className="form-input"
                    value={draft.defaultWallHeightMm}
                    onChange={(e) =>
                      setDraft({ ...draft, defaultWallHeightMm: Number(e.target.value) || 2700 })
                    }
                  />
                  <span className="form-label">Volume depth:</span>
                  <input
                    type="number"
                    className="form-input"
                    value={draft.defaultVolumeDepthMm}
                    onChange={(e) =>
                      setDraft({ ...draft, defaultVolumeDepthMm: Number(e.target.value) || 150 })
                    }
                  />
                  <span className="form-label">Trench width:</span>
                  <input
                    type="number"
                    className="form-input"
                    value={draft.defaultWidthMm}
                    onChange={(e) =>
                      setDraft({ ...draft, defaultWidthMm: Number(e.target.value) || 450 })
                    }
                  />
                  <span className="form-label">Count unit:</span>
                  <input
                    className="form-input"
                    value={draft.defaultCountUnit}
                    onChange={(e) => setDraft({ ...draft, defaultCountUnit: e.target.value })}
                  />
                </div>
              </fieldset>
            </div>
          )}

          {tab === 'Reports' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <fieldset style={{ border: '1px solid var(--border-main)', padding: 10 }}>
                <legend style={{ fontWeight: 600, fontSize: 11, padding: '0 4px' }}>
                  Report Storage &amp; BOQ Settings
                </legend>
                <div className="form-grid">
                  <span className="form-label">Export folder:</span>
                  <input
                    className="form-input"
                    value={draft.reportOutputFolder}
                    onChange={(e) => setDraft({ ...draft, reportOutputFolder: e.target.value })}
                  />
                </div>
              </fieldset>
              <fieldset style={{ border: '1px solid var(--border-main)', padding: 10 }}>
                <legend style={{ fontWeight: 600, fontSize: 11, padding: '0 4px' }}>
                  Database &amp; Data Location (SQLite + DuckDB)
                </legend>
                <div className="form-grid">
                  <span className="form-label">SQLite Database:</span>
                  <span className="mono" style={{ fontSize: 10.5 }}>
                    {engineHealth?.sqlitePath ?? 'engine/data/cobitx.sqlite (Desktop Engine)'}
                  </span>
                  <span className="form-label">DuckDB Analytics:</span>
                  <span className="mono" style={{ fontSize: 10.5 }}>
                    {engineHealth?.duckdbPath ?? 'engine/data/cobitx.duckdb (Desktop Engine)'}
                  </span>
                </div>
              </fieldset>
            </div>
          )}

          {tab === 'AI' && (
            <fieldset style={{ border: '1px solid var(--border-main)', padding: 10 }}>
              <legend style={{ fontWeight: 600, fontSize: 11, padding: '0 4px' }}>
                AI Settings for New Plans (v15.1)
              </legend>
              <div className="form-grid">
                <label className="form-checkbox-row">
                  <input
                    type="checkbox"
                    checked={draft.aiAutoScale}
                    onChange={(e) => setDraft({ ...draft, aiAutoScale: e.target.checked })}
                  />
                  AI Auto Scale on plan import
                </label>
                <label className="form-checkbox-row">
                  <input
                    type="checkbox"
                    checked={draft.aiPlanRename}
                    onChange={(e) => setDraft({ ...draft, aiPlanRename: e.target.checked })}
                  />
                  AI Plan Rename from title block
                </label>
                <label className="form-checkbox-row">
                  <input
                    type="checkbox"
                    checked={draft.showAiAnalysisMessage}
                    onChange={(e) =>
                      setDraft({ ...draft, showAiAnalysisMessage: e.target.checked })
                    }
                  />
                  Show AI plan analysis confirmation message
                </label>
              </div>
            </fieldset>
          )}

          {tab === 'MCP' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <fieldset style={{ border: '1px solid var(--border-main)', padding: 10 }}>
                <legend style={{ fontWeight: 600, fontSize: 11, padding: '0 4px' }}>
                  Built-in CobitX MCP Server (For Claude, Cursor &amp; External AI Agents)
                </legend>
                <div className="form-grid">
                  <label className="form-checkbox-row">
                    <input
                      type="checkbox"
                      checked={draft.mcpServerEnabled}
                      onChange={(e) => setDraft({ ...draft, mcpServerEnabled: e.target.checked })}
                    />
                    Expose CobitX Estimating, Plans, Cost Libraries &amp; BIM QTO via MCP
                  </label>
                  <span className="form-label">Transport / Port:</span>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <select
                      className="form-select"
                      style={{ width: 115 }}
                      value={draft.mcpServerTransport}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          mcpServerTransport: e.target.value as 'stdio' | 'http',
                        })
                      }
                    >
                      <option value="http">HTTP / SSE</option>
                      <option value="stdio">stdio</option>
                    </select>
                    <input
                      type="number"
                      className="form-input mono"
                      style={{ width: 90 }}
                      value={draft.mcpServerPort}
                      onChange={(e) =>
                        setDraft({ ...draft, mcpServerPort: Number(e.target.value) || 47821 })
                      }
                    />
                    <span className="mono" style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
                      http://127.0.0.1:{draft.mcpServerPort}/mcp
                    </span>
                  </div>
                </div>
              </fieldset>

              <fieldset className="mcp-external-servers" style={{ border: '1px solid var(--border-main)', padding: 10 }}>
                <legend style={{ fontWeight: 600, fontSize: 11, padding: '0 4px' }}>
                  External MCP Servers
                </legend>
                <p className="mcp-connection-note">
                  Estimate prices come from saved rates, rate sheets, and imported price lists. External MCP tests check
                  server access. They do not fetch prices or update estimates.
                </p>
                <div className="mcp-connections-table">
                <table className="cubit-table">
                  <thead>
                    <tr>
                      <th>On</th>
                      <th>Server Name</th>
                      <th>Category</th>
                      <th>Transport</th>
                      <th>Endpoint / Command</th>
                      <th className="num">Tools</th>
                      <th>Status</th>
                      <th style={{ width: 64 }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {draft.mcpConnections.map((m) => {
                      const sample = demoEndpoints.get(m.id) === m.endpointOrCommand;
                      const result = probeResults[m.id];
                      const status = sample ? 'Demo' : testingId === m.id ? 'Testing…' :
                        !m.enabled ? 'Disabled' : !result ? 'Untested' : !result.ok ? 'Failed' :
                        m.transport === 'stdio' ? 'Command found' : 'Verified';
                      return (
                        <tr key={m.id}>
                          <td>
                            <input
                              type="checkbox"
                              aria-label={`Enable ${m.name}`}
                              checked={!sample && m.enabled}
                              disabled={sample || testingId === m.id}
                              onChange={() => {
                                setProbeResults(({ [m.id]: _oldResult, ...previous }) => previous);
                                setDraft((previous) => ({
                                  ...previous,
                                  mcpConnections: previous.mcpConnections.map((item) =>
                                    item.id === m.id ? { ...item, enabled: !item.enabled } : item),
                                }));
                              }}
                            />
                          </td>
                          <td title={m.name}>{m.name}</td>
                          <td>{m.category}</td>
                          <td className="mono">{m.transport}</td>
                          <td className="mono" title={m.endpointOrCommand}>{m.endpointOrCommand}</td>
                          <td className="num" title={result ? `${result.resourcesCount ?? 0} resources` : undefined}>
                            {result?.ok && m.enabled && m.transport === 'http' ? result.toolsCount ?? '—' : '—'}
                          </td>
                          <td><span className={`status-badge ${status === 'Verified' ? 'status-won' : 'status-open'}`}>{status}</span></td>
                          <td>
                            <div className="mcp-connection-actions">
                              <button className="pane-icon-btn" title="Test MCP Server Connection" aria-label={`Test ${m.name}`}
                                disabled={sample || !m.enabled || testingId !== null} onClick={() => handleTestMcpServer(m)}>
                                <RefreshCw size={12} color="var(--brand-blue)" />
                              </button>
                              <button className="pane-icon-btn" title="Remove MCP Connection" aria-label={`Remove ${m.name}`}
                                disabled={testingId === m.id}
                                onClick={() => setDraft((previous) => ({
                                  ...previous,
                                  mcpConnections: previous.mcpConnections.filter((item) => item.id !== m.id),
                                }))}>
                                <Trash2 size={12} color="var(--accent-red)" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {!draft.mcpConnections.length && <tr><td colSpan={8}>No external servers configured.</td></tr>}
                  </tbody>
                </table>
                </div>

                {probeMessage && (
                  <div
                    className="mono"
                    style={{
                      fontSize: 10.5,
                      padding: '4px 8px',
                      marginBottom: 8,
                      background: 'var(--bg-toolbar)',
                      border: '1px solid var(--border-light)',
                      borderRadius: 3,
                    }}
                  >
                    {probeMessage}
                  </div>
                )}

                <form className="mcp-add-connection" onSubmit={(event) => {
                  event.preventDefault();
                  handleAddMcp();
                }}>
                  <input
                    className="form-input"
                    placeholder="Connection name"
                    aria-label="Connection name"
                    value={newMcpName}
                    onChange={(e) => setNewMcpName(e.target.value)}
                  />
                  <select
                    className="form-select"
                    aria-label="Server category"
                    value={newMcpCategory}
                    onChange={(e) =>
                      setNewMcpCategory(e.target.value as McpServerConfig['category'])
                    }
                  >
                    <option value="CostLibrary">Cost Library</option>
                    <option value="SupplierPricing">Supplier Pricing</option>
                    <option value="Accounting">Accounting</option>
                    <option value="BIM_CDE">BIM / CDE</option>
                    <option value="Custom">Custom</option>
                  </select>
                  <select
                    className="form-select"
                    aria-label="Server transport"
                    value={newMcpTransport}
                    onChange={(e) => setNewMcpTransport(e.target.value as 'http' | 'stdio')}
                  >
                    <option value="http">http</option>
                    <option value="stdio">stdio</option>
                  </select>
                  <input
                    className="form-input mono"
                    placeholder="URL or stdio command"
                    aria-label="URL or stdio command"
                    value={newMcpEndpoint}
                    onChange={(e) => setNewMcpEndpoint(e.target.value)}
                  />
                  <button className="btn-secondary" disabled={!newMcpName.trim() || !newMcpEndpoint.trim()}>
                    <Plus size={12} /> Add
                  </button>
                </form>
              </fieldset>

              <fieldset style={{ border: '1px solid var(--border-main)', padding: 10 }}>
                <legend style={{ fontWeight: 600, fontSize: 11, padding: '0 4px' }}>
                  Inspect &amp; Run Built-In CobitX MCP Server Tools ({mcpManifest ? `${mcpManifest.tools.length} tools` : 'connecting...'})
                </legend>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
                  <select
                    className="form-select mono"
                    style={{ width: 220 }}
                    value={selectedMcpTool}
                    onChange={(e) => {
                      const t = e.target.value;
                      setSelectedMcpTool(t);
                      if (t === 'cobitx_get_job_summary' || t === 'cobitx_run_formula_audit')
                        setMcpToolArgsJson('{"job_id":"job-1"}');
                      else if (t === 'cobitx_export_boq')
                        setMcpToolArgsJson('{"job_id":"job-1","format":"summary_json"}');
                      else if (t === 'cobitx_search_cost_libraries')
                        setMcpToolArgsJson('{"query":"Concrete"}');
                      else if (t === 'cobitx_trigger_ai_takeoff')
                        setMcpToolArgsJson('{"mode":"scan_text","query_or_symbol":"CONSULT"}');
                      else if (t === 'cobitx_run_boq_sql')
                        setMcpToolArgsJson('{"sql":"SELECT job_id, COUNT(*) AS items, ROUND(SUM(sell_total),2) AS sell FROM estimate_items GROUP BY job_id"}');
                      else setMcpToolArgsJson('{}');
                    }}
                  >
                    {(mcpManifest?.tools ?? [
                      { name: 'cobitx_list_jobs', description: '', argsSchema: {} },
                      { name: 'cobitx_get_job_summary', description: '', argsSchema: {} },
                      { name: 'cobitx_search_cost_libraries', description: '', argsSchema: {} },
                      { name: 'cobitx_run_boq_sql', description: '', argsSchema: {} },
                      { name: 'cobitx_run_formula_audit', description: '', argsSchema: {} },
                      { name: 'cobitx_trigger_ai_takeoff', description: '', argsSchema: {} },
                      { name: 'cobitx_export_boq', description: '', argsSchema: {} },
                    ]).map((tl) => (
                      <option key={tl.name} value={tl.name}>
                        {tl.name}
                      </option>
                    ))}
                  </select>
                  <input
                    className="form-input mono"
                    style={{ flex: 1 }}
                    value={mcpToolArgsJson}
                    onChange={(e) => setMcpToolArgsJson(e.target.value)}
                    placeholder='{"query": "Concrete"}'
                  />
                  <button
                    className="btn-primary"
                    onClick={handleRunBuiltInMcpTool}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                  >
                    <Play size={11} /> Run Tool
                  </button>
                </div>
                {mcpOutput && (
                  <pre
                    className="mono"
                    style={{
                      margin: 0,
                      maxHeight: 110,
                      overflowY: 'auto',
                      fontSize: 10,
                      padding: 6,
                      background: 'var(--bg-toolbar)',
                      border: '1px solid var(--border-light)',
                      borderRadius: 3,
                    }}
                  >
                    {mcpOutput}
                  </pre>
                )}
              </fieldset>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={() => {
              onSave(draft);
              onClose();
            }}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
};

