import React, { useMemo, useRef, useState } from 'react';
import {
  FolderPlus,
  FilePlus2,
  FolderOpen,
  Briefcase,
  Trash2,
  Copy,
  ClipboardPaste,
  Edit3,
  GitMerge,
  Layers,
  Upload,
  Download,
  FileSpreadsheet,
  Tags,
  Users,
  ChevronRight,
  ChevronDown,
  Folder,
  FileText,
  Lock,
  ChevronUp,
} from 'lucide-react';
import type {
  ClientCompany,
  ClientContact,
  FolderNode,
  FreezeStateFlag,
  JobRecord,
  JobStatus,
  ProjectNode,
} from '../../types/cubit';
import { computeJobSummary, formatCurrency } from '../../utils/estimateCalc';
import { ColumnChooserModal, type ColumnDef } from '../modals/ColumnChooserModal';
import {
  exportLegacyArchive,
  importLegacyArchive,
  importPriceListSpreadsheet,
} from '../../services/engineClient';

const JM_ALL_COLUMNS: ColumnDef[] = [
  { key: 'name', label: 'Name', width: 290, required: true },
  { key: 'status', label: 'Status', width: 105 },
  { key: 'total', label: 'Job Total', width: 120 },
  { key: 'builder', label: 'Builder', width: 165 },
  { key: 'accountManager', label: 'Account Manager', width: 120 },
  { key: 'startDate', label: 'Start Date', width: 95 },
  { key: 'lastUpdated', label: 'Last Updated', width: 135 },
  { key: 'freeze', label: 'Freeze State', width: 135 },
  { key: 'template', label: 'Template', width: 75 },
];

const FREEZE_OPTIONS: FreezeStateFlag[] = [
  'None',
  'Quantities',
  'Rates',
  'Options',
  'Option Values',
  'Option Configurations',
  'Estimate',
  'New Items',
  'Job',
];

const STATUS_OPTIONS: JobStatus[] = [
  'Open',
  'Draft Complete',
  'Submitted',
  'Won',
  'Lost',
  'Completed',
  'Cancelled',
];

interface JobManagerViewProps {
  projects: ProjectNode[];
  folders: FolderNode[];
  jobs: JobRecord[];
  companies: ClientCompany[];
  contacts: ClientContact[];
  ribbonCollapsed: boolean;
  onToggleRibbon: () => void;
  showKeytips: boolean;
  onOpenJob: (jobId: string) => void;
  onCreateProject: (name: string) => void;
  onCreateFolder: (projectId: string, name: string) => void;
  onCreateJob: (opts: {
    kind: 'Job' | 'PriceList';
    projectId: string | null;
    name: string;
    templateId?: string;
    removeQuantities?: boolean;
  }) => void;
  onUpdateJob: (jobId: string, patch: Partial<JobRecord>) => void;
  onUpdateProject: (projectId: string, patch: Partial<ProjectNode>) => void;
  onDeleteItem: (kind: 'Project' | 'Folder' | 'Job', id: string) => void;
  onDuplicateJob: (jobId: string, targetProjectId: string | null) => void;
  onMergeJobs: (jobIds: string[], newName: string, includePlans: boolean) => void;
  onImportJobArchive: (job: JobRecord) => void;
  onGroupJob: (job: JobRecord) => void;
  onOpenGroupingCodes: () => void;
  onOpenClientManager: () => void;
  onNotify: (msg: string) => void;
}

export const JobManagerView: React.FC<JobManagerViewProps> = ({
  projects,
  folders,
  jobs,
  companies,
  contacts,
  ribbonCollapsed,
  onToggleRibbon,
  showKeytips,
  onOpenJob,
  onCreateProject,
  onCreateFolder,
  onCreateJob,
  onUpdateJob,
  onUpdateProject,
  onDeleteItem,
  onDuplicateJob,
  onMergeJobs,
  onImportJobArchive,
  onGroupJob,
  onOpenGroupingCodes,
  onOpenClientManager,
  onNotify,
}) => {
  const [activeTab, setActiveTab] = useState<'Jobs' | 'PriceLists'>('Jobs');
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({
    'proj-1': true,
    'proj-2': true,
    'proj-tpl': true,
  });
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({
    'fold-1': true,
  });
  const [selectedNode, setSelectedNode] = useState<{
    type: 'Project' | 'Folder' | 'Job';
    id: string;
  }>({ type: 'Job', id: jobs[0]?.id ?? 'job-1' });
  const [multiSelectedJobIds, setMultiSelectedJobIds] = useState<string[]>([]);
  const [clipboardJobId, setClipboardJobId] = useState<string | null>(null);

  const [visibleColKeys, setVisibleColKeys] = useState<string[]>([
    'name',
    'status',
    'total',
    'builder',
    'lastUpdated',
  ]);
  const [showColumnChooser, setShowColumnChooser] = useState(false);
  const [filters, setFilters] = useState<Record<string, string>>({});

  // New Job / Project / Merge Modals
  const [newJobModal, setNewJobModal] = useState<null | 'Job' | 'PriceList'>(null);
  const [newJobName, setNewJobName] = useState('');
  const [newJobTemplateId, setNewJobTemplateId] = useState('');
  const [removeQuantities, setRemoveQuantities] = useState(true);
  const [newJobDropdownOpen, setNewJobDropdownOpen] = useState(false);

  const [promptModal, setPromptModal] = useState<null | {
    title: string;
    label: string;
    initial: string;
    onConfirm: (val: string) => void;
  }>(null);
  const [promptValue, setPromptValue] = useState('');

  const [deleteConfirmModal, setDeleteConfirmModal] = useState<null | {
    type: 'Project' | 'Folder' | 'Job';
    id: string;
    name: string;
    requiresTypeDelete: boolean;
  }>(null);
  const [deleteText, setDeleteText] = useState('');

  const [mergeModalOpen, setMergeModalOpen] = useState(false);
  const [mergeName, setMergeName] = useState('Merged Estimate Job');
  const [mergeIncludePlans, setMergeIncludePlans] = useState(true);
  const [freezeDropdownOpen, setFreezeDropdownOpen] = useState(false);
  const archiveInputRef = useRef<HTMLInputElement>(null);
  const archiveHintRef = useRef<'Job' | 'PriceList' | undefined>(undefined);

  const handleArchiveFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const lower = file.name.toLowerCase();
      const imported =
        lower.endsWith('.xlsx') || lower.endsWith('.csv')
          ? await importPriceListSpreadsheet(file)
          : await importLegacyArchive(file, archiveHintRef.current);
      onImportJobArchive(imported);
    } catch (err) {
      onNotify(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleExportSelectedArchive = async () => {
    if (!selectedJob) return;
    try {
      const blob = await exportLegacyArchive(selectedJob);
      const ext = selectedJob.kind === 'PriceList' ? 'plx' : 'cbx';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${selectedJob.name.replace(/\s+/g, '_')}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
      onNotify(`Exported "${selectedJob.name}" as .${ext.toUpperCase()} archive.`);
    } catch (err) {
      onNotify(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const jobRecords = useMemo(() => jobs.filter((j) => j.kind === 'Job'), [jobs]);
  const priceLists = useMemo(() => jobs.filter((j) => j.kind === 'PriceList'), [jobs]);
  const templateJobs = useMemo(
    () => jobs.filter((j) => j.useAsTemplate && (activeTab === 'Jobs' ? j.kind === 'Job' : j.kind === 'PriceList')),
    [jobs, activeTab]
  );

  const selectedJob =
    selectedNode.type === 'Job' ? jobs.find((j) => j.id === selectedNode.id) ?? null : null;
  const selectedProject =
    selectedNode.type === 'Project' ? projects.find((p) => p.id === selectedNode.id) ?? null : null;

  const activeColumns = JM_ALL_COLUMNS.filter((c) => visibleColKeys.includes(c.key));

  const matchesFilter = (job: JobRecord) => {
    const nameF = (filters.name ?? '').trim().toLowerCase();
    const statusF = (filters.status ?? '').trim().toLowerCase();
    const builderF = (filters.builder ?? '').trim().toLowerCase();
    const mgrF = (filters.accountManager ?? '').trim().toLowerCase();
    if (nameF && !job.name.toLowerCase().includes(nameF)) return false;
    if (statusF && !job.status.toLowerCase().includes(statusF)) return false;
    if (builderF && !job.builder.toLowerCase().includes(builderF)) return false;
    if (mgrF && !job.accountManager.toLowerCase().includes(mgrF)) return false;
    return true;
  };

  const handleRowClick = (
    e: React.MouseEvent,
    type: 'Project' | 'Folder' | 'Job',
    id: string
  ) => {
    setSelectedNode({ type, id });
    if (type === 'Job') {
      if (e.ctrlKey || e.metaKey) {
        setMultiSelectedJobIds((prev) =>
          prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
        );
      } else {
        setMultiSelectedJobIds([id]);
      }
    } else {
      setMultiSelectedJobIds([]);
    }
  };

  const getTargetProjectId = (): string | null => {
    if (selectedNode.type === 'Project') return selectedNode.id;
    if (selectedNode.type === 'Folder') {
      return folders.find((f) => f.id === selectedNode.id)?.projectId ?? projects[0]?.id ?? null;
    }
    return selectedJob?.projectId ?? projects[0]?.id ?? null;
  };

  const triggerRename = () => {
    if (selectedNode.type === 'Project' && selectedProject) {
      setPromptValue(selectedProject.name);
      setPromptModal({
        title: 'Rename Project',
        label: 'Project Name:',
        initial: selectedProject.name,
        onConfirm: (val) => onUpdateProject(selectedProject.id, { name: val }),
      });
    } else if (selectedNode.type === 'Job' && selectedJob) {
      setPromptValue(selectedJob.name);
      setPromptModal({
        title: `Rename ${selectedJob.kind === 'PriceList' ? 'Price List' : 'Job'}`,
        label: 'Name:',
        initial: selectedJob.name,
        onConfirm: (val) => onUpdateJob(selectedJob.id, { name: val }),
      });
    }
  };

  const triggerDelete = () => {
    if (selectedNode.type === 'Project' && selectedProject) {
      const hasChildren =
        folders.some((f) => f.projectId === selectedProject.id) ||
        jobs.some((j) => j.projectId === selectedProject.id);
      setDeleteText('');
      setDeleteConfirmModal({
        type: 'Project',
        id: selectedProject.id,
        name: selectedProject.name,
        requiresTypeDelete: hasChildren,
      });
    } else if (selectedNode.type === 'Folder') {
      const f = folders.find((x) => x.id === selectedNode.id);
      if (!f) return;
      const hasChildren = jobs.some((j) => j.folderId === f.id);
      setDeleteText('');
      setDeleteConfirmModal({
        type: 'Folder',
        id: f.id,
        name: f.name,
        requiresTypeDelete: hasChildren,
      });
    } else if (selectedNode.type === 'Job' && selectedJob) {
      setDeleteText('');
      setDeleteConfirmModal({
        type: 'Job',
        id: selectedJob.id,
        name: selectedJob.name,
        requiresTypeDelete: false,
      });
    }
  };

  const renderStatusBadge = (status: JobStatus) => {
    const cls =
      status === 'Open'
        ? 'status-open'
        : status === 'Submitted'
        ? 'status-submitted'
        : status === 'Won' || status === 'Completed'
        ? 'status-won'
        : status === 'Draft Complete'
        ? 'status-draft'
        : 'status-locked';
    return <span className={`status-badge ${cls}`}>{status}</span>;
  };

  const renderCell = (job: JobRecord, key: string) => {
    switch (key) {
      case 'status':
        return renderStatusBadge(job.status);
      case 'total':
        return (
          <span className="mono">
            {job.kind === 'PriceList' ? '—' : formatCurrency(computeJobSummary(job).grandTotal)}
          </span>
        );
      case 'builder':
        return job.builder || '—';
      case 'accountManager':
        return job.accountManager || '—';
      case 'startDate':
        return <span className="mono">{job.startDate}</span>;
      case 'lastUpdated':
        return <span className="mono">{job.lastUpdated}</span>;
      case 'freeze':
        return job.freezeStates.includes('None') || job.freezeStates.length === 0
          ? 'None'
          : job.freezeStates.join(', ');
      case 'template':
        return job.useAsTemplate ? 'Yes' : 'No';
      default:
        return '';
    }
  };

  const toggleFreezeFlag = (flag: FreezeStateFlag, current: FreezeStateFlag[], onChange: (next: FreezeStateFlag[]) => void) => {
    if (flag === 'None') {
      onChange(['None']);
      return;
    }
    const withoutNone = current.filter((f) => f !== 'None');
    const exists = withoutNone.includes(flag);
    const next = exists ? withoutNone.filter((f) => f !== flag) : [...withoutNone, flag];
    onChange(next.length === 0 ? ['None'] : next);
  };

  const activeMeta = selectedJob ?? selectedProject;
  const activeMetaCompany = companies.find((c) => c.id === activeMeta?.companyId) ?? null;
  const activeMetaContacts = contacts.filter((c) => c.companyId === activeMeta?.companyId);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Job Manager Ribbon */}
      <div className="ribbon-container">
        <div className="ribbon-tabs-row">
          <div className="ribbon-tabs-left">
            <button className="ribbon-tab-btn active">Job Manager</button>
          </div>
          <div className="ribbon-tabs-right">
            <span>Database: Local (CobitX Standalone)</span>
            <button
              className="ribbon-collapse-btn"
              onClick={onToggleRibbon}
              title="Hide or show ribbon (Ctrl+F1)"
            >
              {ribbonCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
            </button>
          </div>
        </div>

        {!ribbonCollapsed && (
          <div className="ribbon-body">
            {/* List Group */}
            <div className="ribbon-group">
              <div className="ribbon-group-controls">
                <button
                  className="ribbon-btn-lg"
                  disabled={!selectedJob}
                  onClick={() => selectedJob && onOpenJob(selectedJob.id)}
                >
                  {showKeytips && <span className="keytip-badge">O</span>}
                  <FolderOpen size={18} color="var(--brand-blue)" />
                  <span>Open</span>
                </button>

                <button
                  className="ribbon-btn-lg"
                  onClick={() => {
                    setPromptValue('');
                    setPromptModal({
                      title: 'New Project',
                      label: 'Project Name:',
                      initial: '',
                      onConfirm: (val) => onCreateProject(val),
                    });
                  }}
                >
                  {showKeytips && <span className="keytip-badge">NP</span>}
                  <Briefcase size={18} color="var(--brand-blue)" />
                  <span>New Project</span>
                </button>

                <div style={{ position: 'relative' }}>
                  <button
                    className="ribbon-btn-lg"
                    onClick={() => setNewJobDropdownOpen((v) => !v)}
                  >
                    {showKeytips && <span className="keytip-badge">NJ</span>}
                    <FilePlus2 size={18} color="#16a34a" />
                    <span>New Job ▾</span>
                  </button>
                  {newJobDropdownOpen && (
                    <div className="context-menu" style={{ position: 'absolute', top: 54, left: 0 }}>
                      <button
                        className="context-menu-item"
                        onClick={() => {
                          setNewJobDropdownOpen(false);
                          setNewJobName('');
                          setNewJobTemplateId('');
                          setNewJobModal('Job');
                        }}
                      >
                        <span>New Job...</span>
                      </button>
                      <button
                        className="context-menu-item"
                        onClick={() => {
                          setNewJobDropdownOpen(false);
                          setNewJobName('');
                          setNewJobTemplateId('');
                          setNewJobModal('PriceList');
                        }}
                      >
                        <span>New Price List...</span>
                      </button>
                    </div>
                  )}
                </div>

                <button
                  className="ribbon-btn-lg"
                  disabled={!getTargetProjectId()}
                  onClick={() => {
                    const pid = getTargetProjectId();
                    if (!pid) return;
                    setPromptValue('');
                    setPromptModal({
                      title: 'New Folder',
                      label: 'Folder Name:',
                      initial: '',
                      onConfirm: (val) => onCreateFolder(pid, val),
                    });
                  }}
                >
                  <FolderPlus size={18} color="#d97706" />
                  <span>New Folder</span>
                </button>

                <div className="ribbon-btn-stack">
                  <button className="ribbon-btn-sm" onClick={triggerRename} disabled={selectedNode.type === 'Folder'}>
                    <Edit3 size={13} /> Rename
                  </button>
                  <button className="ribbon-btn-sm" onClick={triggerDelete}>
                    <Trash2 size={13} color="var(--accent-red)" /> Delete
                  </button>
                </div>
              </div>
              <div className="ribbon-group-label">List</div>
            </div>

            {/* Job Actions Group */}
            <div className="ribbon-group">
              <div className="ribbon-group-controls">
                <div className="ribbon-btn-stack">
                  <button
                    className="ribbon-btn-sm"
                    disabled={!selectedJob}
                    onClick={() => {
                      if (selectedJob) {
                        setClipboardJobId(selectedJob.id);
                        onNotify(`Copied "${selectedJob.name}" to Job Manager clipboard.`);
                      }
                    }}
                  >
                    <Copy size={13} /> Copy
                  </button>
                  <button
                    className="ribbon-btn-sm"
                    disabled={!clipboardJobId}
                    onClick={() => {
                      if (clipboardJobId) {
                        onDuplicateJob(clipboardJobId, getTargetProjectId());
                      }
                    }}
                  >
                    <ClipboardPaste size={13} /> Paste
                  </button>
                </div>

                <button
                  className="ribbon-btn-lg"
                  disabled={multiSelectedJobIds.length < 2}
                  title="Hold Ctrl and select 2 or more Jobs to merge"
                  onClick={() => setMergeModalOpen(true)}
                >
                  <GitMerge size={18} color="var(--brand-blue)" />
                  <span>Merge</span>
                </button>

                <button
                  className="ribbon-btn-lg"
                  disabled={!selectedJob}
                  onClick={() => selectedJob && onGroupJob(selectedJob)}
                >
                  <Layers size={18} color="#7c3aed" />
                  <span>Group Job</span>
                </button>
              </div>
              <div className="ribbon-group-label">Job Actions</div>
            </div>

            {/* Data Group */}
            <div className="ribbon-group">
              <div className="ribbon-group-controls">
                <input
                  ref={archiveInputRef}
                  type="file"
                  accept=".cbx,.plx,.e0x,.xml,.json,.xlsx,.csv"
                  style={{ display: 'none' }}
                  onChange={handleArchiveFileSelected}
                />
                <button
                  className="ribbon-btn-lg"
                  onClick={() => {
                    archiveHintRef.current = activeTab === 'Jobs' ? 'Job' : 'PriceList';
                    archiveInputRef.current?.click();
                  }}
                >
                  <Upload size={18} color="var(--brand-blue)" />
                  <span>Import</span>
                </button>
                <button
                  className="ribbon-btn-lg"
                  disabled={!selectedJob}
                  onClick={handleExportSelectedArchive}
                >
                  <Download size={18} color="var(--brand-blue)" />
                  <span>Export</span>
                </button>
                <button
                  className="ribbon-btn-lg"
                  onClick={() => {
                    archiveHintRef.current = 'Job';
                    archiveInputRef.current?.click();
                  }}
                >
                  <FileSpreadsheet size={18} color="#0d9488" />
                  <span>Import Global</span>
                </button>
                <button
                  className="ribbon-btn-lg"
                  onClick={onOpenGroupingCodes}
                >
                  <Tags size={18} color="#d97706" />
                  <span>Codes</span>
                </button>
              </div>
              <div className="ribbon-group-label">Data</div>
            </div>

            {/* Client Group */}
            <div className="ribbon-group">
              <div className="ribbon-group-controls">
                <button className="ribbon-btn-lg" onClick={onOpenClientManager}>
                  {showKeytips && <span className="keytip-badge">CM</span>}
                  <Users size={18} color="var(--brand-blue)" />
                  <span>Manage</span>
                </button>
              </div>
              <div className="ribbon-group-label">Client</div>
            </div>
          </div>
        )}
      </div>

      {/* Main Split: Jobs / Price Lists Tree-Grid + Right Details Inspector */}
      <div className="jm-main">
        <div className="jm-list-pane">
          <div className="jm-subtabs">
            <div className="jm-subtabs-left">
              <button
                className={`jm-subtab ${activeTab === 'Jobs' ? 'active' : ''}`}
                onClick={() => setActiveTab('Jobs')}
              >
                Jobs ({jobRecords.length})
              </button>
              <button
                className={`jm-subtab ${activeTab === 'PriceLists' ? 'active' : ''}`}
                onClick={() => setActiveTab('PriceLists')}
              >
                Price Lists ({priceLists.length})
              </button>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              Right-click column header for Column Chooser · Double-click Job to Open
            </div>
          </div>

          <div className="jm-grid-wrapper">
            <table className="cubit-table">
              <thead>
                <tr>
                  {activeColumns.map((col) => (
                    <th
                      key={col.key}
                      style={{ width: col.width }}
                      className={col.key === 'total' ? 'num' : ''}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setShowColumnChooser(true);
                      }}
                      title="Right-click for Column Chooser"
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
                <tr className="filter-row">
                  {activeColumns.map((col) => (
                    <td key={col.key}>
                      {['name', 'status', 'builder', 'accountManager'].includes(col.key) && (
                        <input
                          className="filter-input"
                          placeholder={`Filter ${col.label}...`}
                          value={filters[col.key] ?? ''}
                          onChange={(e) =>
                            setFilters((prev) => ({ ...prev, [col.key]: e.target.value }))
                          }
                        />
                      )}
                    </td>
                  ))}
                </tr>
              </thead>
              <tbody>
                {activeTab === 'Jobs' ? (
                  projects.map((proj) => {
                    const isExpanded = !!expandedProjects[proj.id];
                    const projFolders = folders.filter((f) => f.projectId === proj.id);
                    const directJobs = jobRecords.filter(
                      (j) => j.projectId === proj.id && !j.folderId && matchesFilter(j)
                    );

                    return (
                      <React.Fragment key={proj.id}>
                        <tr
                          className={`row-trade ${selectedNode.type === 'Project' && selectedNode.id === proj.id ? 'selected' : ''}`}
                          onClick={(e) => handleRowClick(e, 'Project', proj.id)}
                        >
                          {activeColumns.map((col, idx) => (
                            <td key={col.key}>
                              {idx === 0 ? (
                                <div className="tree-cell">
                                  <button
                                    className="tree-toggle"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setExpandedProjects((p) => ({ ...p, [proj.id]: !isExpanded }));
                                    }}
                                  >
                                    {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                                  </button>
                                  <Briefcase size={13} color="var(--brand-blue)" />
                                  <span>{proj.name}</span>
                                </div>
                              ) : col.key === 'template' ? (
                                proj.useAsTemplate ? 'Yes' : 'No'
                              ) : (
                                ''
                              )}
                            </td>
                          ))}
                        </tr>

                        {isExpanded &&
                          projFolders.map((fold) => {
                            const fExp = !!expandedFolders[fold.id];
                            const fJobs = jobRecords.filter(
                              (j) => j.folderId === fold.id && matchesFilter(j)
                            );
                            return (
                              <React.Fragment key={fold.id}>
                                <tr
                                  className={`row-heading ${selectedNode.type === 'Folder' && selectedNode.id === fold.id ? 'selected' : ''}`}
                                  onClick={(e) => handleRowClick(e, 'Folder', fold.id)}
                                >
                                  {activeColumns.map((col, idx) => (
                                    <td key={col.key}>
                                      {idx === 0 && (
                                        <div className="tree-cell" style={{ paddingLeft: 18 }}>
                                          <button
                                            className="tree-toggle"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setExpandedFolders((p) => ({ ...p, [fold.id]: !fExp }));
                                            }}
                                          >
                                            {fExp ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                                          </button>
                                          <Folder size={13} color="#d97706" />
                                          <span>{fold.name}</span>
                                        </div>
                                      )}
                                    </td>
                                  ))}
                                </tr>
                                {fExp &&
                                  fJobs.map((job) => (
                                    <tr
                                      key={job.id}
                                      className={
                                        multiSelectedJobIds.includes(job.id) ||
                                        (selectedNode.type === 'Job' && selectedNode.id === job.id)
                                          ? 'selected'
                                          : ''
                                      }
                                      onClick={(e) => handleRowClick(e, 'Job', job.id)}
                                      onDoubleClick={() => onOpenJob(job.id)}
                                      style={{ cursor: 'pointer' }}
                                    >
                                      {activeColumns.map((col, idx) => (
                                        <td key={col.key} className={col.key === 'total' ? 'num' : ''}>
                                          {idx === 0 ? (
                                            <div className="tree-cell" style={{ paddingLeft: 40 }}>
                                              <FileText size={13} color="var(--brand-blue)" />
                                              <span>{job.name}</span>
                                              {!job.freezeStates.includes('None') && (
                                                <Lock size={11} color="var(--accent-red)" />
                                              )}
                                            </div>
                                          ) : (
                                            renderCell(job, col.key)
                                          )}
                                        </td>
                                      ))}
                                    </tr>
                                  ))}
                              </React.Fragment>
                            );
                          })}

                        {isExpanded &&
                          directJobs.map((job) => (
                            <tr
                              key={job.id}
                              className={
                                multiSelectedJobIds.includes(job.id) ||
                                (selectedNode.type === 'Job' && selectedNode.id === job.id)
                                  ? 'selected'
                                  : ''
                              }
                              onClick={(e) => handleRowClick(e, 'Job', job.id)}
                              onDoubleClick={() => onOpenJob(job.id)}
                              style={{ cursor: 'pointer' }}
                            >
                              {activeColumns.map((col, idx) => (
                                <td key={col.key} className={col.key === 'total' ? 'num' : ''}>
                                  {idx === 0 ? (
                                    <div className="tree-cell" style={{ paddingLeft: 22 }}>
                                      <FileText size={13} color="var(--brand-blue)" />
                                      <span>{job.name}</span>
                                    </div>
                                  ) : (
                                    renderCell(job, col.key)
                                  )}
                                </td>
                              ))}
                            </tr>
                          ))}
                      </React.Fragment>
                    );
                  })
                ) : (
                  priceLists.filter(matchesFilter).map((pl) => (
                    <tr
                      key={pl.id}
                      className={selectedNode.type === 'Job' && selectedNode.id === pl.id ? 'selected' : ''}
                      onClick={(e) => handleRowClick(e, 'Job', pl.id)}
                      onDoubleClick={() => onOpenJob(pl.id)}
                      style={{ cursor: 'pointer' }}
                    >
                      {activeColumns.map((col, idx) => (
                        <td key={col.key} className={col.key === 'total' ? 'num' : ''}>
                          {idx === 0 ? (
                            <div className="tree-cell">
                              <FileSpreadsheet size={13} color="#0d9488" />
                              <span>{pl.name}</span>
                            </div>
                          ) : (
                            renderCell(pl, col.key)
                          )}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right Metadata Inspector: Project/Job Details + Site Address + Client Details */}
        <div className="jm-inspector">
          {activeMeta ? (
            <>
              <div className="inspector-section">
                <div className="inspector-title">
                  <span>
                    {selectedJob
                      ? selectedJob.kind === 'PriceList'
                        ? 'Price List Details'
                        : 'Job Details'
                      : 'Project Details'}
                  </span>
                  {selectedJob && (
                    <button
                      className="btn-primary"
                      style={{ height: 21, padding: '0 9px', fontSize: 11 }}
                      onClick={() => onOpenJob(selectedJob.id)}
                    >
                      Open {selectedJob.kind === 'PriceList' ? 'List' : 'Job'}
                    </button>
                  )}
                </div>

                <div className="form-grid">
                  <span className="form-label">Name:</span>
                  <input
                    className="form-input"
                    value={activeMeta.name}
                    onChange={(e) =>
                      selectedJob
                        ? onUpdateJob(selectedJob.id, { name: e.target.value })
                        : selectedProject && onUpdateProject(selectedProject.id, { name: e.target.value })
                    }
                  />

                  <span className="form-label">Description:</span>
                  <input
                    className="form-input"
                    value={activeMeta.description}
                    onChange={(e) =>
                      selectedJob
                        ? onUpdateJob(selectedJob.id, { description: e.target.value })
                        : selectedProject &&
                          onUpdateProject(selectedProject.id, { description: e.target.value })
                    }
                  />

                  <span className="form-label">Builder:</span>
                  <input
                    className="form-input"
                    value={activeMeta.builder}
                    onChange={(e) =>
                      selectedJob
                        ? onUpdateJob(selectedJob.id, { builder: e.target.value })
                        : selectedProject &&
                          onUpdateProject(selectedProject.id, { builder: e.target.value })
                    }
                  />

                  <span className="form-label">Start Date:</span>
                  <input
                    type="date"
                    className="form-input"
                    value={activeMeta.startDate}
                    onChange={(e) =>
                      selectedJob
                        ? onUpdateJob(selectedJob.id, { startDate: e.target.value })
                        : selectedProject &&
                          onUpdateProject(selectedProject.id, { startDate: e.target.value })
                    }
                  />

                  <span className="form-label">Status:</span>
                  <select
                    className="form-select"
                    value={activeMeta.status}
                    onChange={(e) => {
                      const val = e.target.value as JobStatus;
                      if (selectedJob) onUpdateJob(selectedJob.id, { status: val });
                      else if (selectedProject) onUpdateProject(selectedProject.id, { status: val });
                    }}
                  >
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>

                  <span className="form-label">Freeze State:</span>
                  <div style={{ position: 'relative' }}>
                    <button
                      type="button"
                      className="form-select"
                      style={{ textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis' }}
                      onClick={() => setFreezeDropdownOpen((v) => !v)}
                    >
                      {activeMeta.freezeStates.join(', ')}
                    </button>
                    {freezeDropdownOpen && (
                      <div
                        className="context-menu"
                        style={{ position: 'absolute', top: 25, left: 0, width: '100%', zIndex: 40, padding: 6 }}
                      >
                        {FREEZE_OPTIONS.map((flag) => (
                          <label
                            key={flag}
                            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 4px', cursor: 'pointer' }}
                          >
                            <input
                              type="checkbox"
                              checked={activeMeta.freezeStates.includes(flag)}
                              onChange={() =>
                                toggleFreezeFlag(flag, activeMeta.freezeStates, (next) => {
                                  if (selectedJob) onUpdateJob(selectedJob.id, { freezeStates: next });
                                  else if (selectedProject)
                                    onUpdateProject(selectedProject.id, { freezeStates: next });
                                })
                              }
                            />
                            <span>{flag}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>

                  <label className="form-checkbox-row">
                    <input
                      type="checkbox"
                      checked={activeMeta.useAsTemplate}
                      onChange={(e) =>
                        selectedJob
                          ? onUpdateJob(selectedJob.id, { useAsTemplate: e.target.checked })
                          : selectedProject &&
                            onUpdateProject(selectedProject.id, { useAsTemplate: e.target.checked })
                      }
                    />
                    Use as template
                  </label>
                </div>

                <div className="inspector-subtitle">Site Address</div>
                <div className="form-grid">
                  {(['street', 'suburb', 'state', 'postcode', 'country'] as const).map((field) => (
                    <React.Fragment key={field}>
                      <span className="form-label" style={{ textTransform: 'capitalize' }}>
                        {field}:
                      </span>
                      <input
                        className="form-input"
                        value={activeMeta.siteAddress[field]}
                        onChange={(e) => {
                          const nextAddr = { ...activeMeta.siteAddress, [field]: e.target.value };
                          if (selectedJob) onUpdateJob(selectedJob.id, { siteAddress: nextAddr });
                          else if (selectedProject)
                            onUpdateProject(selectedProject.id, { siteAddress: nextAddr });
                        }}
                      />
                    </React.Fragment>
                  ))}
                </div>
              </div>

              <div className="inspector-section">
                <div className="inspector-title">
                  <span>Client Details</span>
                  <button
                    className="btn-secondary"
                    style={{ height: 20, padding: '0 8px', fontSize: 11 }}
                    onClick={onOpenClientManager}
                  >
                    Manage
                  </button>
                </div>
                <div className="form-grid">
                  <span className="form-label">Company:</span>
                  <select
                    className="form-select"
                    value={activeMeta.companyId ?? ''}
                    onChange={(e) => {
                      const cid = e.target.value || null;
                      const pri = contacts.find((c) => c.companyId === cid && c.isPrimary) ?? contacts.find((c) => c.companyId === cid);
                      const patch = { companyId: cid, contactId: pri?.id ?? null };
                      if (selectedJob) onUpdateJob(selectedJob.id, patch);
                      else if (selectedProject) onUpdateProject(selectedProject.id, patch);
                    }}
                  >
                    <option value="">— Unassigned —</option>
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>

                  <span className="form-label">Contact:</span>
                  <select
                    className="form-select"
                    value={activeMeta.contactId ?? ''}
                    onChange={(e) => {
                      const contId = e.target.value || null;
                      if (selectedJob) onUpdateJob(selectedJob.id, { contactId: contId });
                      else if (selectedProject) onUpdateProject(selectedProject.id, { contactId: contId });
                    }}
                  >
                    <option value="">— Select Contact —</option>
                    {activeMetaContacts.map((ct) => (
                      <option key={ct.id} value={ct.id}>
                        {ct.name} {ct.isPrimary ? '(Primary)' : ''}
                      </option>
                    ))}
                  </select>
                </div>

                {activeMetaCompany && (
                  <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                    <div>
                      {activeMetaCompany.street}, {activeMetaCompany.suburb} {activeMetaCompany.state}
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div style={{ padding: 16, color: 'var(--text-muted)' }}>
              Select a Project or Job to inspect its metadata.
            </div>
          )}
        </div>
      </div>

      {/* Column Chooser Modal */}
      {showColumnChooser && (
        <ColumnChooserModal
          title="Jobs List"
          allColumns={JM_ALL_COLUMNS}
          visibleKeys={visibleColKeys}
          onToggleColumn={(k) =>
            setVisibleColKeys((prev) =>
              prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]
            )
          }
          onClose={() => setShowColumnChooser(false)}
        />
      )}

      {/* New Job / Price List Modal */}
      {newJobModal && (
        <div className="modal-backdrop" onClick={() => setNewJobModal(null)}>
          <div className="modal-window" style={{ width: 420 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span>{newJobModal === 'PriceList' ? 'New Price List' : 'New Job'}</span>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!newJobName.trim()) return;
                onCreateJob({
                  kind: newJobModal,
                  projectId: newJobModal === 'Job' ? getTargetProjectId() : null,
                  name: newJobName.trim(),
                  templateId: newJobTemplateId || undefined,
                  removeQuantities,
                });
                setNewJobModal(null);
              }}
            >
              <div className="modal-body">
                <div className="form-grid">
                  <span className="form-label">Name:</span>
                  <input
                    autoFocus
                    className="form-input"
                    placeholder={newJobModal === 'PriceList' ? 'e.g. Subcontractor Rates 2026' : 'e.g. Northgate Retail Fitout'}
                    value={newJobName}
                    onChange={(e) => setNewJobName(e.target.value)}
                  />

                  <span className="form-label">Template:</span>
                  <select
                    className="form-select"
                    value={newJobTemplateId}
                    onChange={(e) => setNewJobTemplateId(e.target.value)}
                  >
                    <option value="">(Blank)</option>
                    {templateJobs.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>

                  {newJobModal === 'Job' && newJobTemplateId && (
                    <label className="form-checkbox-row">
                      <input
                        type="checkbox"
                        checked={removeQuantities}
                        onChange={(e) => setRemoveQuantities(e.target.checked)}
                      />
                      Remove Quantities from template
                    </label>
                  )}
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setNewJobModal(null)}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary">
                  OK
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Generic Prompt Modal (New Project / Folder / Rename) */}
      {promptModal && (
        <div className="modal-backdrop" onClick={() => setPromptModal(null)}>
          <div className="modal-window" style={{ width: 380 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span>{promptModal.title}</span>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!promptValue.trim()) return;
                promptModal.onConfirm(promptValue.trim());
                setPromptModal(null);
              }}
            >
              <div className="modal-body">
                <div className="form-grid">
                  <span className="form-label">{promptModal.label}</span>
                  <input
                    autoFocus
                    className="form-input"
                    value={promptValue}
                    onChange={(e) => setPromptValue(e.target.value)}
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setPromptModal(null)}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary">
                  OK
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirm Modal (requires typing DELETE if Project/Folder has children) */}
      {deleteConfirmModal && (
        <div className="modal-backdrop" onClick={() => setDeleteConfirmModal(null)}>
          <div className="modal-window" style={{ width: 410 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span>Confirm Delete {deleteConfirmModal.type}</span>
            </div>
            <div className="modal-body">
              <p style={{ marginTop: 0 }}>
                Are you sure you want to permanently delete <strong>{deleteConfirmModal.name}</strong>?
              </p>
              {deleteConfirmModal.requiresTypeDelete && (
                <div>
                  <p style={{ color: 'var(--accent-red)', fontSize: 11.5 }}>
                    This {deleteConfirmModal.type} contains child items. Type <strong>DELETE</strong> below to confirm:
                  </p>
                  <input
                    autoFocus
                    className="form-input"
                    value={deleteText}
                    onChange={(e) => setDeleteText(e.target.value)}
                  />
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setDeleteConfirmModal(null)}>
                Cancel
              </button>
              <button
                className="btn-primary"
                style={{ background: 'var(--accent-red)', borderColor: '#b91c1c' }}
                disabled={deleteConfirmModal.requiresTypeDelete && deleteText !== 'DELETE'}
                onClick={() => {
                  onDeleteItem(deleteConfirmModal.type, deleteConfirmModal.id);
                  setDeleteConfirmModal(null);
                }}
              >
                {deleteConfirmModal.requiresTypeDelete ? 'Continue' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Merge Jobs Modal */}
      {mergeModalOpen && (
        <div className="modal-backdrop" onClick={() => setMergeModalOpen(false)}>
          <div className="modal-window" style={{ width: 440 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span>Merge Jobs ({multiSelectedJobIds.length} selected)</span>
            </div>
            <div className="modal-body">
              <div className="form-grid">
                <span className="form-label">New Job Name:</span>
                <input
                  className="form-input"
                  value={mergeName}
                  onChange={(e) => setMergeName(e.target.value)}
                />
                <label className="form-checkbox-row">
                  <input
                    type="checkbox"
                    checked={mergeIncludePlans}
                    onChange={(e) => setMergeIncludePlans(e.target.checked)}
                  />
                  Include Plans from each Job
                </label>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setMergeModalOpen(false)}>
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={() => {
                  onMergeJobs(multiSelectedJobIds, mergeName, mergeIncludePlans);
                  setMergeModalOpen(false);
                }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
