import React, { useState } from 'react';
import { Building2, UserPlus, GitMerge, Star, X } from 'lucide-react';
import type { ClientCompany, ClientContact } from '../../types/cubit';

interface ClientManagerModalProps {
  companies: ClientCompany[];
  contacts: ClientContact[];
  codeLabel: string;
  onAddCompany: (comp: ClientCompany) => void;
  onAddContact: (cont: ClientContact) => void;
  onSetPrimaryContact: (companyId: string, contactId: string) => void;
  onClose: () => void;
}

export const ClientManagerModal: React.FC<ClientManagerModalProps> = ({
  companies,
  contacts,
  codeLabel,
  onAddCompany,
  onAddContact,
  onSetPrimaryContact,
  onClose,
}) => {
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>(companies[0]?.id ?? '');
  const [newCompanyName, setNewCompanyName] = useState('');
  const [newContactName, setNewContactName] = useState('');
  const [newContactEmail, setNewContactEmail] = useState('');
  const [showNewComp, setShowNewComp] = useState(false);
  const [showNewCont, setShowNewCont] = useState(false);

  const companyContacts = contacts.filter((c) => c.companyId === selectedCompanyId && !c.archived);

  const handleCreateCompany = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCompanyName.trim()) return;
    const comp: ClientCompany = {
      id: `comp-${Date.now()}`,
      name: newCompanyName.trim(),
      code: '',
      street: '',
      suburb: '',
      state: 'NSW',
      postcode: '',
      country: 'Australia',
    };
    onAddCompany(comp);
    setSelectedCompanyId(comp.id);
    setNewCompanyName('');
    setShowNewComp(false);
  };

  const handleCreateContact = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newContactName.trim() || !selectedCompanyId) return;
    const cont: ClientContact = {
      id: `cont-${Date.now()}`,
      companyId: selectedCompanyId,
      name: newContactName.trim(),
      mobile: '',
      phone: '',
      email: newContactEmail.trim(),
      isPrimary: companyContacts.length === 0,
    };
    onAddContact(cont);
    setNewContactName('');
    setNewContactEmail('');
    setShowNewCont(false);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-window"
        style={{ width: 780, height: 500 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <span>Client Manager</span>
          <button className="modal-close" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        {/* Client Manager Ribbon */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 10px',
            background: 'var(--bg-ribbon)',
            borderBottom: '1px solid var(--border-main)',
          }}
        >
          <button
            className="btn-secondary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
            onClick={() => setShowNewComp(true)}
          >
            <Building2 size={13} color="var(--brand-blue)" /> Create Company
          </button>
          <button
            className="btn-secondary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
            onClick={() => setShowNewCont(true)}
            disabled={!selectedCompanyId}
          >
            <UserPlus size={13} color="var(--brand-blue)" /> Create Contact
          </button>
          <button
            className="btn-secondary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
            title="Select multiple rows with Ctrl to merge"
          >
            <GitMerge size={13} /> Merge
          </button>
        </div>

        <div
          className="modal-body"
          style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, padding: 10 }}
        >
          {/* Companies Pane */}
          <div style={{ display: 'flex', flexDirection: 'column', border: '1px solid var(--border-main)' }}>
            <div className="pane-titlebar">Companies ({companies.length})</div>
            {showNewComp && (
              <form
                onSubmit={handleCreateCompany}
                style={{ padding: 8, background: '#f8fafc', borderBottom: '1px solid var(--border-main)', display: 'flex', gap: 6 }}
              >
                <input
                  autoFocus
                  className="form-input"
                  placeholder="Company name..."
                  value={newCompanyName}
                  onChange={(e) => setNewCompanyName(e.target.value)}
                />
                <button type="submit" className="btn-primary">Create</button>
              </form>
            )}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              <table className="cubit-table">
                <thead>
                  <tr>
                    <th>Company Name</th>
                    <th style={{ width: 110 }}>{codeLabel}</th>
                    <th style={{ width: 90 }}>Suburb</th>
                  </tr>
                </thead>
                <tbody>
                  {companies.map((c) => (
                    <tr
                      key={c.id}
                      className={selectedCompanyId === c.id ? 'selected' : ''}
                      onClick={() => setSelectedCompanyId(c.id)}
                      style={{ cursor: 'pointer' }}
                    >
                      <td>{c.name}</td>
                      <td className="mono">{c.code}</td>
                      <td>{c.suburb}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Contacts Pane */}
          <div style={{ display: 'flex', flexDirection: 'column', border: '1px solid var(--border-main)' }}>
            <div className="pane-titlebar">
              Contacts ({companyContacts.length}) — Click star to set Primary
            </div>
            {showNewCont && (
              <form
                onSubmit={handleCreateContact}
                style={{ padding: 8, background: '#f8fafc', borderBottom: '1px solid var(--border-main)', display: 'flex', gap: 6 }}
              >
                <input
                  autoFocus
                  className="form-input"
                  placeholder="Contact name..."
                  value={newContactName}
                  onChange={(e) => setNewContactName(e.target.value)}
                />
                <input
                  className="form-input"
                  placeholder="Email..."
                  value={newContactEmail}
                  onChange={(e) => setNewContactEmail(e.target.value)}
                />
                <button type="submit" className="btn-primary">Create</button>
              </form>
            )}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              <table className="cubit-table">
                <thead>
                  <tr>
                    <th style={{ width: 32 }}>Pri</th>
                    <th>Name</th>
                    <th>Email</th>
                    <th style={{ width: 95 }}>Mobile</th>
                  </tr>
                </thead>
                <tbody>
                  {companyContacts.map((ct) => (
                    <tr key={ct.id}>
                      <td style={{ textAlign: 'center' }}>
                        <button
                          onClick={() => onSetPrimaryContact(selectedCompanyId, ct.id)}
                          title={ct.isPrimary ? 'Primary Contact' : 'Set as Primary Contact'}
                          style={{ border: 'none', background: 'transparent', padding: 2 }}
                        >
                          <Star
                            size={13}
                            fill={ct.isPrimary ? '#0066b3' : '#cbd5e1'}
                            color={ct.isPrimary ? '#0066b3' : '#94a3b8'}
                          />
                        </button>
                      </td>
                      <td>{ct.name}</td>
                      <td>{ct.email}</td>
                      <td className="mono">{ct.mobile}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn-primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
