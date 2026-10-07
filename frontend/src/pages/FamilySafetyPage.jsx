import React, { useState, useEffect } from 'react';
import { AlertCircle, Plus, Trash2, Edit2, Save, X, Send, Phone, Mail, Shield, Clock, History, Users, ToggleLeft, CheckCircle2, XCircle } from 'lucide-react';
import { getState } from '../lib/store';
import '../styles/FamilySafety.css';
import { API_BASE } from '../lib/apiConfig';

export default function FamilySafetyPage() {
  const token = localStorage.getItem('factech_token') || localStorage.getItem('auth_token');
  const [tab, setTab] = useState('contacts'); // 'contacts', 'preferences', 'history', 'sos'
  const [contacts, setContacts] = useState([]);
  const [preferences, setPreferences] = useState(null);
  const [history, setHistory] = useState([]);
  
  const [showAddContact, setShowAddContact] = useState(false);
  const [editingContactId, setEditingContactId] = useState(null);
  const [formData, setFormData] = useState({ name: '', relationship: '', phone: '', email: '', preferred_method: 'email', is_emergency_contact: false });
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  
  const [sosMessage, setSosMessage] = useState('');
  const [showSosConfirm, setShowSosConfirm] = useState(false);

  // Load data on mount
  useEffect(() => {
    fetchContacts();
    fetchPreferences();
    fetchHistory();
  }, []);

  const fetchContacts = async () => {
    try {
      const res = await fetch(`${API_BASE}/family/contacts`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        setContacts(await res.json());
      }
    } catch (err) {
      console.error('Failed to load contacts:', err);
    }
  };

  const fetchPreferences = async () => {
    try {
      const res = await fetch(`${API_BASE}/family/preferences`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        setPreferences(await res.json());
      }
    } catch (err) {
      console.error('Failed to load preferences:', err);
    }
  };

  const fetchHistory = async () => {
    try {
      const res = await fetch(`${API_BASE}/family/history`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        setHistory(await res.json());
      }
    } catch (err) {
      console.error('Failed to load history:', err);
    }
  };

  const saveContact = async () => {
    if (!formData.name || (!formData.email && !formData.phone)) {
      setError('Name and either email or phone are required');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const method = editingContactId ? 'PUT' : 'POST';
      const url = editingContactId 
        ? `${API_BASE}/family/contacts/${editingContactId}`
        : `${API_BASE}/family/contacts`;

      const res = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      if (res.ok) {
        setSuccess(editingContactId ? 'Contact updated' : 'Contact added');
        setFormData({ name: '', relationship: '', phone: '', email: '', preferred_method: 'email', is_emergency_contact: false });
        setEditingContactId(null);
        setShowAddContact(false);
        fetchContacts();
        setTimeout(() => setSuccess(''), 2000);
      } else {
        const err = await res.json();
        setError(err.detail || 'Failed to save contact');
      }
    } catch (err) {
      setError('Error saving contact: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const deleteContact = async (id) => {
    if (!confirm('Remove this contact?')) return;
    try {
      const res = await fetch(`${API_BASE}/family/contacts/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        fetchContacts();
      }
    } catch (err) {
      setError('Failed to delete contact');
    }
  };

  const toggleContact = async (id) => {
    try {
      const res = await fetch(`${API_BASE}/family/contacts/${id}/toggle`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        fetchContacts();
      }
    } catch (err) {
      setError('Failed to toggle contact');
    }
  };

  const updatePreference = async (key, value) => {
    try {
      const res = await fetch(`${API_BASE}/family/preferences`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: value })
      });
      if (res.ok) {
        fetchPreferences();
      }
    } catch (err) {
      setError('Failed to update preferences');
    }
  };

  const toggleEnabled = async () => {
    await updatePreference('is_enabled', !preferences?.is_enabled);
  };

  const setConsent = async (consent) => {
    try {
      const res = await fetch(`${API_BASE}/family/preferences/consent`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ consent })
      });
      if (res.ok) {
        setSuccess(consent ? 'Consent given' : 'Consent revoked');
        fetchPreferences();
        setTimeout(() => setSuccess(''), 2000);
      }
    } catch (err) {
      setError('Failed to update consent');
    }
  };

  const sendUpdateNow = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/family/send-update-now`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
      });
      if (res.ok) {
        const result = await res.json();
        setSuccess(`Update sent to ${result.sent_count}/${result.total_contacts} contacts`);
        fetchHistory();
        setTimeout(() => setSuccess(''), 3000);
      } else {
        const err = await res.json();
        setError(err.detail || 'Failed to send update');
      }
    } catch (err) {
      setError('Error: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const sendSOS = async () => {
    if (!sosMessage.trim()) {
      setError('Please enter a message');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/family/sos`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: sosMessage })
      });
      if (res.ok) {
        const result = await res.json();
        setSuccess(`🚨 SOS sent to ${result.sent_count} emergency contacts`);
        setSosMessage('');
        setShowSosConfirm(false);
        fetchHistory();
        setTimeout(() => setSuccess(''), 4000);
      } else {
        const err = await res.json();
        setError(err.detail || 'Failed to send SOS');
      }
    } catch (err) {
      setError('Error: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const clearHistory = async () => {
    if (!confirm('Clear all update history? This cannot be undone.')) return;
    try {
      const res = await fetch(`${API_BASE}/family/history/clear-all`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        fetchHistory();
        setSuccess('History cleared');
        setTimeout(() => setSuccess(''), 2000);
      }
    } catch (err) {
      setError('Failed to clear history');
    }
  };

  return (
    <div className="family-safety-container">
      <div className="family-safety-header">
        <h1>
          <Shield size={28} /> Family Safety & Updates
        </h1>
        <p>Automatically notify family contacts with your status</p>
      </div>

      {error && (
        <div className="alert alert-error">
          <AlertCircle size={16} />
          <span>{error}</span>
          <button onClick={() => setError('')} className="alert-close"><X size={16} /></button>
        </div>
      )}

      {success && (
        <div className="alert alert-success">
          <CheckCircle2 size={16} />
          <span>{success}</span>
        </div>
      )}

      <div className="fs-tabs">
        <button className={`tab ${tab === 'contacts' ? 'active' : ''}`} onClick={() => setTab('contacts')}>
          <Users size={18} /> Contacts
        </button>
        <button className={`tab ${tab === 'preferences' ? 'active' : ''}`} onClick={() => setTab('preferences')}>
          <Clock size={18} /> Settings
        </button>
        <button className={`tab ${tab === 'history' ? 'active' : ''}`} onClick={() => setTab('history')}>
          <History size={18} /> History
        </button>
        <button className={`tab ${tab === 'sos' ? 'active' : ''}`} onClick={() => setTab('sos')}>
          <AlertCircle size={18} /> Emergency
        </button>
      </div>

      <div className="fs-content">
        {/* Contacts Tab */}
        {tab === 'contacts' && (
          <div className="fs-section">
            <div className="section-header">
              <h2>Family Contacts</h2>
              <button className="btn btn-primary" onClick={() => setShowAddContact(!showAddContact)}>
                <Plus size={18} /> Add Contact
              </button>
            </div>

            {showAddContact && (
              <div className="contact-form">
                <div className="form-group">
                  <label>Name *</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="e.g., Mother"
                  />
                </div>

                <div className="form-group">
                  <label>Relationship</label>
                  <select value={formData.relationship} onChange={(e) => setFormData({ ...formData, relationship: e.target.value })}>
                    <option value="">Select...</option>
                    <option value="Mother">Mother</option>
                    <option value="Father">Father</option>
                    <option value="Sister">Sister</option>
                    <option value="Brother">Brother</option>
                    <option value="Caregiver">Caregiver</option>
                    <option value="Friend">Friend</option>
                    <option value="Doctor">Doctor</option>
                  </select>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Email</label>
                    <input
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      placeholder="email@example.com"
                    />
                  </div>
                  <div className="form-group">
                    <label>Phone</label>
                    <input
                      type="tel"
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                      placeholder="+1234567890"
                    />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Notification Method</label>
                    <select value={formData.preferred_method} onChange={(e) => setFormData({ ...formData, preferred_method: e.target.value })}>
                      <option value="email">Email</option>
                      <option value="sms">SMS</option>
                      <option value="whatsapp">WhatsApp</option>
                      <option value="push">Push Notification</option>
                    </select>
                  </div>
                  <div className="form-group checkbox">
                    <label>
                      <input
                        type="checkbox"
                        checked={formData.is_emergency_contact}
                        onChange={(e) => setFormData({ ...formData, is_emergency_contact: e.target.checked })}
                      />
                      Emergency Contact (SOS)
                    </label>
                  </div>
                </div>

                <div className="form-actions">
                  <button className="btn btn-primary" onClick={saveContact} disabled={loading}>
                    <Save size={16} /> Save Contact
                  </button>
                  <button className="btn btn-secondary" onClick={() => { setShowAddContact(false); setEditingContactId(null); setFormData({ name: '', relationship: '', phone: '', email: '', preferred_method: 'email', is_emergency_contact: false }); }}>
                    Cancel
                  </button>
                </div>
              </div>
            )}

            <div className="contacts-list">
              {contacts.length === 0 ? (
                <p className="empty-state">No family contacts yet. Add your first contact to get started.</p>
              ) : (
                contacts.map(contact => (
                  <div key={contact.id} className={`contact-card ${!contact.is_active ? 'disabled' : ''}`}>
                    <div className="contact-info">
                      <div className="contact-name">{contact.name}</div>
                      {contact.relationship && <div className="contact-relationship">{contact.relationship}</div>}
                      <div className="contact-details">
                        {contact.email && (
                          <span className="detail">
                            <Mail size={14} /> {contact.email}
                          </span>
                        )}
                        {contact.phone && (
                          <span className="detail">
                            <Phone size={14} /> {contact.phone}
                          </span>
                        )}
                      </div>
                      {contact.is_emergency_contact && (
                        <span className="badge badge-danger">Emergency</span>
                      )}
                    </div>
                    <div className="contact-actions">
                      <button
                        className={`btn-toggle ${contact.is_active ? 'active' : ''}`}
                        onClick={() => toggleContact(contact.id)}
                        title={contact.is_active ? 'Disable' : 'Enable'}
                      >
                        <ToggleLeft size={18} />
                      </button>
                      <button className="btn btn-small btn-secondary" onClick={() => deleteContact(contact.id)}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Preferences Tab */}
        {tab === 'preferences' && preferences && (
          <div className="fs-section">
            <h2>Update Settings & Consent</h2>

            <div className="preferences-card">
              <div className="pref-row">
                <div className="pref-label">
                  <h3>Enable Family Updates</h3>
                  <p>Automatically send periodic status reports to selected family contacts</p>
                </div>
                <button
                  className={`toggle-button ${preferences.is_enabled ? 'on' : 'off'}`}
                  onClick={toggleEnabled}
                >
                  {preferences.is_enabled ? 'ON' : 'OFF'}
                </button>
              </div>

              {preferences.is_enabled && (
                <>
                  <div className="pref-row">
                    <div className="pref-label">
                      <h3>I give consent for family updates</h3>
                      <p>You must explicitly consent before automatic reports are sent</p>
                    </div>
                    <div className="consent-buttons">
                      <button
                        className={`btn ${preferences.has_given_consent ? 'btn-success' : 'btn-secondary'}`}
                        onClick={() => setConsent(true)}
                      >
                        <CheckCircle2 size={16} /> Give Consent
                      </button>
                      <button
                        className={`btn ${!preferences.has_given_consent ? 'btn-secondary' : 'btn-secondary'}`}
                        onClick={() => setConsent(false)}
                      >
                        <XCircle size={16} /> Revoke
                      </button>
                    </div>
                  </div>

                  {preferences.has_given_consent && (
                    <>
                      <div className="pref-row">
                        <div className="pref-label">
                          <h3>Update Frequency</h3>
                          <p>How often to send status updates</p>
                        </div>
                        <select
                          value={preferences.update_frequency}
                          onChange={(e) => updatePreference('update_frequency', e.target.value)}
                          className="pref-select"
                        >
                          <option value="1h">Every 1 hour</option>
                          <option value="3h">Every 3 hours</option>
                          <option value="6h">Every 6 hours</option>
                          <option value="12h">Every 12 hours</option>
                          <option value="daily">Daily</option>
                        </select>
                      </div>

                      <div className="pref-section">
                        <h3>What to include in updates:</h3>
                        <label className="checkbox-pref">
                          <input
                            type="checkbox"
                            checked={preferences.include_status}
                            onChange={(e) => updatePreference('include_status', e.target.checked)}
                          />
                          <span>User Status (active/idle)</span>
                        </label>
                        <label className="checkbox-pref">
                          <input
                            type="checkbox"
                            checked={preferences.include_timestamp}
                            onChange={(e) => updatePreference('include_timestamp', e.target.checked)}
                          />
                          <span>Timestamp</span>
                        </label>
                        <label className="checkbox-pref">
                          <input
                            type="checkbox"
                            checked={preferences.include_conversation_summary}
                            onChange={(e) => updatePreference('include_conversation_summary', e.target.checked)}
                          />
                          <span>Conversation Summary (if available)</span>
                        </label>
                        <label className="checkbox-pref">
                          <input
                            type="checkbox"
                            checked={preferences.include_location}
                            onChange={(e) => updatePreference('include_location', e.target.checked)}
                          />
                          <span>Location (if permission granted)</span>
                        </label>
                      </div>

                      <div className="action-row">
                        <button className="btn btn-success" onClick={sendUpdateNow} disabled={loading}>
                          <Send size={16} /> Send Update Now
                        </button>
                      </div>
                    </>
                  )}
                </>
              )}
            </div>

            <div className="privacy-notice">
              <AlertCircle size={16} />
              <p>
                <strong>Privacy:</strong> Only information explicitly configured by you will be sent. Private conversations are never shared automatically.
                You can disable updates at any time.
              </p>
            </div>
          </div>
        )}

        {/* History Tab */}
        {tab === 'history' && (
          <div className="fs-section">
            <div className="section-header">
              <h2>Update History</h2>
              {history.length > 0 && (
                <button className="btn btn-secondary" onClick={clearHistory}>
                  <Trash2 size={16} /> Clear History
                </button>
              )}
            </div>

            <div className="history-list">
              {history.length === 0 ? (
                <p className="empty-state">No updates sent yet.</p>
              ) : (
                history.map(item => (
                  <div key={item.id} className={`history-item status-${item.delivery_status}`}>
                    <div className="history-status">
                      {item.delivery_status === 'sent' && <CheckCircle2 size={18} />}
                      {item.delivery_status === 'failed' && <XCircle size={18} />}
                      {item.delivery_status === 'pending' && <Clock size={18} />}
                    </div>
                    <div className="history-info">
                      <div className="history-type">{item.update_type.toUpperCase()}</div>
                      <div className="history-time">
                        {new Date(item.sent_at * 1000).toLocaleString()}
                      </div>
                      <div className="history-message">{item.message_content}</div>
                      {item.error_message && (
                        <div className="history-error">Error: {item.error_message}</div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Emergency SOS Tab */}
        {tab === 'sos' && (
          <div className="fs-section">
            <h2>🚨 Emergency SOS</h2>

            <div className="sos-notice">
              <AlertCircle size={20} />
              <p>
                Immediately notify all emergency contacts with your SOS message.
                This bypasses normal scheduling and sends right away.
              </p>
            </div>

            {!showSosConfirm ? (
              <div className="sos-button-area">
                <button
                  className="btn btn-danger btn-large"
                  onClick={() => setShowSosConfirm(true)}
                >
                  🚨 TRIGGER SOS
                </button>
                <p className="sos-help">
                  Emergency contacts are marked with a red badge in the Contacts list.
                  Make sure you have emergency contacts added before triggering SOS.
                </p>
              </div>
            ) : (
              <div className="sos-confirm">
                <h3>Send Emergency Alert?</h3>
                <p>This will immediately notify all emergency contacts.</p>

                <div className="form-group">
                  <label>Emergency Message</label>
                  <textarea
                    value={sosMessage}
                    onChange={(e) => setSosMessage(e.target.value)}
                    placeholder="Describe the emergency..."
                    rows={4}
                  />
                </div>

                <div className="sos-actions">
                  <button
                    className="btn btn-danger"
                    onClick={sendSOS}
                    disabled={loading || !sosMessage.trim()}
                  >
                    <AlertCircle size={16} /> Send SOS
                  </button>
                  <button
                    className="btn btn-secondary"
                    onClick={() => { setShowSosConfirm(false); setSosMessage(''); }}
                    disabled={loading}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
