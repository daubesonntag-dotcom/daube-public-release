'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styles from './amora.module.css';
import { TurnstileField, turnstileConfigured } from '@/components/turnstile-field';
import { FounderOperations } from './FounderOperations';

type Profile = {
  display_name: string;
  access_role: string;
  account_status: string;
  team?: string | null;
  branch_ids?: number[];
};

type ModuleId = 'overview' | 'founder' | 'students' | 'classes' | 'attendance' | 'learning' | 'tuition' | 'staff' | 'crm' | 'progress' | 'reports' | 'camera' | 'integrations' | 'access' | 'security' | 'guide';

type Row = Record<string, unknown>;

const MODULES: Array<{ group: string; id: ModuleId; label: string }> = [
  { group: 'TỔNG QUAN', id: 'overview', label: 'Overview' },
  { group: 'FOUNDER', id: 'founder', label: 'Founder Studio' },
  { group: 'VẬN HÀNH', id: 'students', label: 'Students 360' },
  { group: 'VẬN HÀNH', id: 'classes', label: 'Classes & Schedule' },
  { group: 'VẬN HÀNH', id: 'attendance', label: 'Attendance' },
  { group: 'VẬN HÀNH', id: 'tuition', label: 'Tuition & Ledger' },
  { group: 'VẬN HÀNH', id: 'staff', label: 'Staff & Payroll' },
  { group: 'VẬN HÀNH', id: 'crm', label: 'Admissions CRM' },
  { group: 'HỌC TẬP', id: 'learning', label: 'Teaching & Learning Library' },
  { group: 'HỌC TẬP', id: 'progress', label: 'Progress & Passport' },
  { group: 'CÔNG CỤ', id: 'reports', label: 'Reports & Print' },
  { group: 'CÔNG CỤ', id: 'camera', label: 'Camera Hub' },
  { group: 'CÔNG CỤ', id: 'integrations', label: 'Integrations' },
  { group: 'QUẢN TRỊ', id: 'access', label: 'People & Access' },
  { group: 'QUẢN TRỊ', id: 'security', label: 'Security Center' },
  { group: 'TRỢ GIÚP', id: 'guide', label: 'HDSD' }
];

const QA: Record<string, Row[]> = {
  students: [{ student_code: 'QA-001', full_name: 'Học viên QA', status: 'active', school: 'Synthetic only' }],
  classes: [{ class_code: 'QA-CAM-A2', schedule_summary: 'T3 · T5 18:00', status: 'active', capacity: 12 }],
  leads: [{ full_name: 'Lead QA', guardian_name: 'Phụ huynh QA', pipeline_stage: 'trial_booked', source: 'QA' }],
  invoices: [{ invoice_number: 'QA-INV-001', total: 1290000, status: 'issued' }]
};

const money = (value: unknown) => `${new Intl.NumberFormat('vi-VN').format(Number(value || 0))} ₫`;
const text = (value: unknown) => value == null ? '' : Array.isArray(value) ? value.join(', ') : String(value);

function canSee(role: string, id: ModuleId) {
  if (!role) return false;
  if (id === 'founder') return ['founder', 'cofounder'].includes(role);
  if (['founder', 'cofounder', 'center_manager'].includes(role)) return true;
  if (role === 'it_admin') return ['overview', 'camera', 'integrations', 'access', 'security', 'guide'].includes(id);
  if (['teacher', 'teaching_assistant'].includes(role)) return ['overview', 'students', 'classes', 'attendance', 'learning', 'progress', 'reports', 'guide'].includes(id);
  if (role === 'admissions') return ['overview', 'students', 'classes', 'crm', 'reports', 'guide'].includes(id);
  if (role === 'finance') return ['overview', 'tuition', 'staff', 'reports', 'security', 'guide'].includes(id);
  if (role === 'auditor') return ['overview', 'students', 'tuition', 'staff', 'reports', 'security', 'access', 'guide'].includes(id);
  if (['parent', 'student'].includes(role)) return ['overview', 'progress', 'guide'].includes(id);
  return ['overview', 'students', 'classes', 'guide'].includes(id);
}

function DataTable({ rows, columns }: { rows: Row[]; columns: Array<[string, string | ((row: Row) => unknown)]> }) {
  if (!rows.length) return <div className={styles.empty}>Chưa có dữ liệu.</div>;
  return <div className={styles.tableWrap}><table><thead><tr>{columns.map(([label]) => <th key={label}>{label}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{columns.map(([label, key]) => <td key={label}>{text(typeof key === 'function' ? key(row) : row[key])}</td>)}</tr>)}</tbody></table></div>;
}

function Metric({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return <div className={`${styles.card} ${styles.metric}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>;
}

export function AmoraClient({ supabaseUrl, publishableKey }: { supabaseUrl: string; publishableKey: string }) {
  const [token, setToken] = useState('');
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaResetKey, setCaptchaResetKey] = useState(0);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [qa, setQa] = useState(false);
  const [page, setPage] = useState<ModuleId>('overview');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [rows, setRows] = useState<Record<string, Row[]>>({});
  const [flags, setFlags] = useState<Row[]>([]);
  const [overview, setOverview] = useState({ students: 0, classes: 0, leads: 0, invoices: 0 });
  const [leadMessage, setLeadMessage] = useState('');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const headers = useCallback((extra: Record<string, string> = {}) => ({
    apikey: publishableKey,
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra
  }), [publishableKey, token]);

  const api = useCallback(async (path: string, init: RequestInit = {}) => {
    if (!supabaseUrl || !publishableKey) throw new Error('AMORA data-plane configuration is unavailable.');
    const response = await fetch(`${supabaseUrl}${path}`, { ...init, headers: headers((init.headers || {}) as Record<string, string>) });
    const raw = await response.text();
    let body: unknown = raw;
    try { body = raw ? JSON.parse(raw) : null; } catch { /* keep text */ }
    if (!response.ok) {
      const message = typeof body === 'object' && body && 'message' in body ? String((body as { message: unknown }).message) : raw || `HTTP ${response.status}`;
      throw new Error(message);
    }
    return body;
  }, [headers, publishableKey, supabaseUrl]);

  const rest = useCallback(async (table: string, select = '*', query = '') => {
    const result = await api(`/rest/v1/${table}?select=${encodeURIComponent(select)}${query ? `&${query}` : ''}`);
    return Array.isArray(result) ? result as Row[] : [];
  }, [api]);

  const role = qa ? 'founder' : profile?.access_role || '';
  const visibleModules = useMemo(() => MODULES.filter(module => canSee(role, module.id)), [role]);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const loadPage = useCallback(async (target: ModuleId) => {
    stopCamera();
    setError('');
    setLoading(true);
    try {
      if (qa) {
        if (target === 'overview') setOverview({ students: 1, classes: 1, leads: 1, invoices: 1290000 });
        setRows({ students: QA.students, classes: QA.classes, leads: QA.leads, invoices: QA.invoices });
        setFlags([
          { key: 'real_student_data_admission', enabled: false, description: 'Locked until role/branch QA passes' },
          { key: 'facial_recognition_attendance', enabled: false, description: 'Off by default' },
          { key: 'camera_cctv_gateway', enabled: false, description: 'Private gateway required' }
        ]);
        return;
      }
      if (!token) return;
      if (target === 'overview') {
        const [students, classes, leads, invoices] = await Promise.all([
          rest('amora_students', 'id', 'test_record=eq.false'),
          rest('amora_classes', 'id', 'test_record=eq.false&status=eq.active'),
          rest('amora_leads', 'id', 'test_record=eq.false&pipeline_stage=neq.converted&pipeline_stage=neq.lost'),
          rest('amora_invoices', 'total,status', 'test_record=eq.false&status=in.(issued,partially_paid,overdue)')
        ]);
        setOverview({ students: students.length, classes: classes.length, leads: leads.length, invoices: invoices.reduce((sum, row) => sum + Number(row.total || 0), 0) });
      }
      const jobs: Array<Promise<void>> = [];
      const load = (key: string, table: string, select: string, query = '') => jobs.push(rest(table, select, query).then(data => setRows(old => ({ ...old, [key]: data }))));
      if (target === 'students') load('students', 'amora_students', 'student_code,full_name,preferred_name,status,school,branch_id', 'test_record=eq.false&order=full_name.asc&limit=200');
      if (target === 'classes') load('classes', 'amora_classes', 'class_code,schedule_summary,status,capacity,branch_id', 'test_record=eq.false&order=class_code.asc');
      if (target === 'attendance') load('attendance', 'amora_attendance_records', 'recorded_at,status,note,student_id,session_id', 'test_record=eq.false&order=recorded_at.desc&limit=100');
      if (target === 'learning') load('learning', 'amora_learning_resources', 'id,resource_type,title,summary,language,level,skills,topics,learning_objectives,visibility,lifecycle,source_type,source_title,source_author,source_publisher,source_url,citation_text,license_code,version,updated_at', 'test_record=eq.false&order=updated_at.desc&limit=200');
      if (target === 'tuition') {
        load('invoices', 'amora_invoices', 'invoice_number,total,currency,status,issue_date,due_date,student_id', 'test_record=eq.false&order=issue_date.desc&limit=100');
        load('payments', 'amora_payments', 'amount,currency,status,method,received_at,invoice_id', 'test_record=eq.false&order=received_at.desc&limit=100');
      }
      if (target === 'staff') {
        load('staff', 'amora_staff_profiles', 'employee_code,full_name,role_label,employment_status,start_date', 'test_record=eq.false&order=full_name.asc');
        load('payroll', 'amora_payroll_periods', 'starts_on,ends_on,status,approved_at', 'test_record=eq.false&order=starts_on.desc&limit=24');
      }
      if (target === 'crm') load('leads', 'amora_leads', 'id,full_name,guardian_name,phone,email,level_interest,pipeline_stage,source,created_at', 'test_record=eq.false&order=created_at.desc&limit=200');
      if (target === 'progress') {
        load('progress', 'amora_progress_reports', 'student_id,period_start,period_end,status,summary,published_at', 'test_record=eq.false&order=period_end.desc&limit=100');
        load('passport', 'amora_passport_ledger', 'student_id,event_type,points,stamp_code,reason,occurred_at', 'test_record=eq.false&order=occurred_at.desc&limit=100');
      }
      if (target === 'reports') load('reportTemplates', 'amora_report_templates', 'code,name,category,format_targets', 'active=eq.true&order=category.asc');
      if (target === 'camera') load('cameras', 'amora_camera_endpoints', 'name,camera_type,zone,status,public_endpoint,retention_policy_reference', 'test_record=eq.false&order=name.asc');
      if (target === 'integrations') load('integrations', 'amora_integrations', 'display_name,provider_type,connection_state,granted_scopes,last_verified_at,last_error_summary', 'order=display_name.asc');
      if (target === 'access') load('roles', 'amora_role_permissions', 'role,description,permissions', 'order=role.asc');
      if (target === 'security') {
        load('security', 'amora_security_events', 'created_at,event_type,severity,detail_summary,resolved_at', 'test_record=eq.false&order=created_at.desc&limit=100');
        jobs.push(rest('amora_feature_flags', 'key,enabled,description', 'order=key.asc').then(setFlags));
      }
      await Promise.all(jobs);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [qa, rest, stopCamera, token]);

  useEffect(() => { if (token || qa) void loadPage(page); }, [loadPage, page, qa, token]);
  useEffect(() => () => stopCamera(), [stopCamera]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') || '').trim();
    const password = String(form.get('password') || '');
    if (!email || !password) return setError('Nhập email và mật khẩu.');
    if (turnstileConfigured() && !captchaToken) return setError('Hãy hoàn tất xác minh chống bot.');
    setLoading(true);
    try {
      const session = await api('/auth/v1/token?grant_type=password', {
        method: 'POST',
        body: JSON.stringify({
          email,
          password,
          gotrue_meta_security: captchaToken ? { captcha_token: captchaToken } : undefined
        })
      }) as { access_token?: string; user?: { id?: string } };
      if (!session.access_token || !session.user?.id) throw new Error('Authentication did not return a valid session.');
      setToken(session.access_token);
      const response = await fetch(`${supabaseUrl}/rest/v1/amora_profiles?select=display_name,access_role,account_status,team,branch_ids&user_id=eq.${session.user.id}`, {
        headers: { apikey: publishableKey, Authorization: `Bearer ${session.access_token}` }
      });
      const profiles = await response.json() as Profile[];
      if (!response.ok || !profiles[0]) throw new Error('Tài khoản hợp lệ nhưng chưa được cấp AMORA profile.');
      if (profiles[0].account_status !== 'active') throw new Error('AMORA account is not active.');
      if (profiles[0].access_role === 'it_admin') {
        setToken('');
        throw new Error('D’AUBE IT không đăng nhập bằng mật khẩu. Hãy dùng nút Passkey.');
      }
      setProfile(profiles[0]);
      setPage('overview');
    } catch (err) {
      setToken('');
      setProfile(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      setCaptchaToken('');
      setCaptchaResetKey(value => value + 1);
    }
  }

  async function createLead(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (qa) return;
    setLeadMessage('');
    const form = new FormData(event.currentTarget);
    const fullName = String(form.get('fullName') || '').trim();
    if (!fullName) return setLeadMessage('Nhập tên lead.');
    try {
      await api('/rest/v1/amora_leads', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          full_name: fullName,
          guardian_name: String(form.get('guardian') || '').trim() || null,
          phone: String(form.get('phone') || '').trim() || null,
          level_interest: String(form.get('level') || '').trim() || null,
          source: 'AMORA OS · D’AUBE',
          pipeline_stage: 'new',
          test_record: false
        })
      });
      event.currentTarget.reset();
      setLeadMessage('✓ Saved');
      await loadPage('crm');
    } catch (err) { setLeadMessage(err instanceof Error ? err.message : String(err)); }
  }

  async function startCamera() {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }

  function exportCsv() {
    const values = [
      ['metric', 'value'], ['mode', qa ? 'QA synthetic' : 'authenticated production'],
      ['active_students', overview.students], ['active_classes', overview.classes], ['open_admissions', overview.leads], ['outstanding_invoice_total_vnd', overview.invoices], ['exported_at', new Date().toISOString()]
    ];
    const csv = values.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = 'amora-overview.csv'; anchor.click();
    URL.revokeObjectURL(url);
  }

  if (!qa && !profile) {
    return <main className={styles.loginWrap}><section className={styles.loginCard}>
      <div className={styles.brand}><div className={styles.mark}>A</div><div><h1>AMORA OS</h1><small>Cambridge English Center Management</small></div></div>
      <p>Hệ điều hành riêng cho Founder, Co‑Founder và đội ngũ AMORA. Tài khoản chỉ được cấp bởi người có thẩm quyền.</p>
      <form onSubmit={login}>
        <label>Email<input name="email" type="email" autoComplete="username" placeholder="you@amora..." /></label>
        <label>Mật khẩu<input name="password" type="password" autoComplete="current-password" placeholder="••••••••" /></label>
        <TurnstileField action="amora-signin" onToken={setCaptchaToken} resetKey={captchaResetKey} />
        <div className={styles.actions}><button className={styles.primary} disabled={loading || (turnstileConfigured() && !captchaToken)}>{loading ? 'Đang kiểm tra…' : 'Đăng nhập'}</button><button type="button" onClick={() => { setQa(true); setPage('overview'); }}>Xem QA demo</button><a className={styles.darkButton} href="https://amora-os.floot.app/it-access" target="_blank" rel="noreferrer">D’AUBE IT · Passkey</a></div>
      </form>
      {error && <div className={styles.error}>{error}</div>}
      <div className={styles.notice}>Dữ liệu học sinh thật đang <b>khóa admission</b> cho tới khi role/branch QA hoàn tất. Không dùng facial recognition mặc định. CCTV thật chỉ nối qua gateway/NVR riêng.</div>
    </section></main>;
  }

  const module = visibleModules.find(item => item.id === page) || visibleModules[0];
  const title = module?.label || 'AMORA OS';

  return <div className={styles.shell}>
    <aside className={styles.sidebar}>
      <div className={styles.brand}><div className={styles.mark}>A</div><div><h1>AMORA OS</h1><small>{qa ? 'QA synthetic mode' : `${profile?.display_name} · ${profile?.access_role}`}</small></div></div>
      <nav>{visibleModules.map((item, index) => <div key={item.id}>{index === 0 || visibleModules[index - 1]?.group !== item.group ? <div className={styles.group}>{item.group}</div> : null}<button className={page === item.id ? styles.active : ''} onClick={() => setPage(item.id)}>{item.label}</button></div>)}</nav>
      <div className={styles.sideFoot}><b>D’AUBE SONNTAG · Primary IT</b><br/>Security · Integrations · Backups · Audit<br/><span>{qa ? 'QA synthetic data only' : 'RLS production data plane'}</span></div>
    </aside>
    <main className={styles.main}>
      <header className={styles.top}><div><h2>{title}</h2><p>Meaningful operations, visible and auditable.</p></div><div className={styles.actions}><span className={styles.rolePill}>{qa ? 'QA' : role}</span><button onClick={() => void loadPage(page)}>Refresh</button>{qa ? <button onClick={() => { setQa(false); setProfile(null); }}>Exit QA</button> : <button onClick={() => { setToken(''); setProfile(null); }}>Sign out</button>}</div></header>
      {loading && <div className={styles.loading}>Loading current records…</div>}
      {error && <div className={styles.error}>{error}</div>}
      {!loading && page === 'overview' && <div className={styles.grid}>
        <Metric label="Active students" value={overview.students} note="Real records exclude QA/test" />
        <Metric label="Active classes" value={overview.classes} note="Current groups" />
        <Metric label="Open admissions" value={overview.leads} note="Not converted/lost" />
        <Metric label="Outstanding invoices" value={money(overview.invoices)} note="Issued / partial / overdue" />
        <section className={`${styles.card} ${styles.wide}`}><h3>Safety posture</h3><p>Real child-data admission: <b>LOCKED</b><br/>Facial recognition: <b>OFF</b><br/>CCTV public endpoint: <b>FORBIDDEN</b><br/>Local camera: user-permission only.</p></section>
        <section className={`${styles.card} ${styles.wide}`}><h3>Center</h3><p><b>Cơ sở 1</b> · 97/1D Lê Thị Lơ, Tân Hiệp, Hóc Môn<br/><b>Cơ sở 2</b> · 21/3 Trung Nữ Vương, Hóc Môn</p></section>
      </div>}
      {!loading && page === 'founder' && <FounderOperations api={api} qa={qa} />}
      {!loading && page === 'students' && <section className={styles.card}><div className={styles.sectionHead}><h3>Student directory</h3><button disabled>New student · Pilot gate</button></div><DataTable rows={rows.students || []} columns={[["Code",'student_code'],["Name",'full_name'],["Preferred",'preferred_name'],["Status",'status'],["School",'school']]} /></section>}
      {!loading && page === 'classes' && <section className={styles.card}><DataTable rows={rows.classes || []} columns={[["Class",'class_code'],["Schedule",'schedule_summary'],["Status",'status'],["Capacity",'capacity']]} /></section>}
      {!loading && page === 'attendance' && <section className={styles.card}><DataTable rows={rows.attendance || []} columns={[["Recorded",'recorded_at'],["Student",'student_id'],["Session",'session_id'],["Status",'status'],["Note",'note']]} /></section>}
      {!loading && page === 'learning' && <div className={styles.grid}>
        <section className={`${styles.card} ${styles.wide}`}>
          <div className={styles.sectionHead}><div><h3>Teaching & Learning Library</h3><p className={styles.muted}>Giáo án, teacher guides, worksheets, assessments và nguồn tham khảo có provenance.</p></div><button disabled>New resource · migration gate</button></div>
          <DataTable rows={rows.learning || []} columns={[["Type",'resource_type'],["Title",'title'],["Level",'level'],["Skills",'skills'],["Lifecycle",'lifecycle'],["Visibility",'visibility'],["Version",'version']]} />
        </section>
        <section className={`${styles.card} ${styles.wide}`}>
          <h3>Source & rights</h3>
          <DataTable rows={rows.learning || []} columns={[["Resource",'title'],["Source type",'source_type'],["Source",'source_title'],["Author",'source_author'],["Publisher",'source_publisher'],["License",'license_code'],["Citation",'citation_text']]} />
          <p className={styles.muted}>External references do not imply AMORA ownership. Restricted third-party material requires recorded usage rights before attachment or redistribution.</p>
        </section>
      </div>}
      {!loading && page === 'tuition' && <div className={styles.grid}><section className={`${styles.card} ${styles.wide}`}><h3>Invoices</h3><DataTable rows={rows.invoices || []} columns={[["Invoice",'invoice_number'],["Total",row=>money(row.total)],["Status",'status'],["Due",'due_date']]} /></section><section className={`${styles.card} ${styles.wide}`}><h3>Payments</h3><DataTable rows={rows.payments || []} columns={[["Received",'received_at'],["Amount",row=>money(row.amount)],["Method",'method'],["Status",'status']]} /></section></div>}
      {!loading && page === 'staff' && <div className={styles.grid}><section className={`${styles.card} ${styles.wide}`}><h3>Staff</h3><DataTable rows={rows.staff || []} columns={[["Code",'employee_code'],["Name",'full_name'],["Role",'role_label'],["Status",'employment_status']]} /></section><section className={`${styles.card} ${styles.wide}`}><h3>Payroll periods</h3><DataTable rows={rows.payroll || []} columns={[["From",'starts_on'],["To",'ends_on'],["Status",'status'],["Approved",'approved_at']]} /></section></div>}
      {!loading && page === 'crm' && <><section className={styles.card}><DataTable rows={rows.leads || []} columns={[["Lead",'full_name'],["Guardian",'guardian_name'],["Phone",'phone'],["Level",'level_interest'],["Stage",'pipeline_stage'],["Source",'source']]} /></section>{!qa && <form className={`${styles.card} ${styles.form}`} onSubmit={createLead}><h3>Quick lead intake</h3><div className={styles.formGrid}><label>Student / lead name<input name="fullName" /></label><label>Guardian<input name="guardian" /></label><label>Phone<input name="phone" /></label><label>Level interest<input name="level" placeholder="Starters / Movers / Flyers..." /></label></div><div className={styles.actions}><button className={styles.primary}>Create lead</button><span>{leadMessage}</span></div></form>}</>}
      {!loading && page === 'progress' && <div className={styles.grid}><section className={`${styles.card} ${styles.wide}`}><h3>Progress reports</h3><DataTable rows={rows.progress || []} columns={[["Student",'student_id'],["Period",row=>`${text(row.period_start)} → ${text(row.period_end)}`],["Status",'status'],["Summary",'summary']]} /></section><section className={`${styles.card} ${styles.wide}`}><h3>AMORA Passport</h3><DataTable rows={rows.passport || []} columns={[["Student",'student_id'],["Event",'event_type'],["Points",'points'],["Stamp",'stamp_code'],["Reason",'reason']]} /></section></div>}
      {!loading && page === 'reports' && <><div className={styles.actions}><button onClick={() => window.print()}>Print / PDF</button><button onClick={exportCsv}>Export overview CSV</button></div><section className={styles.card}><DataTable rows={rows.reportTemplates || []} columns={[["Code",'code'],["Template",'name'],["Category",'category'],["Formats",'format_targets']]} /></section><div className={styles.notice}>Founder Studio provides governed datasets and D’AUBE Document Studio handoff. Microsoft 365 / Power BI stay ready_to_connect until Founder authorization; AMORA OS never fakes a connected state.</div></>}
      {!loading && page === 'camera' && <div className={styles.grid}><section className={`${styles.card} ${styles.wide}`}><h3>Local device camera</h3><div className={styles.camera}><video ref={videoRef} autoPlay muted playsInline /></div><div className={styles.actions}><button className={styles.primary} onClick={() => void startCamera()}>Start camera</button><button onClick={stopCamera}>Stop</button></div><p>Permission stays on this device. Audio is not requested.</p></section><section className={`${styles.card} ${styles.wide}`}><h3>Registered endpoints</h3><DataTable rows={rows.cameras || []} columns={[["Name",'name'],["Type",'camera_type'],["Zone",'zone'],["Status",'status'],["Public",row=>String(row.public_endpoint)]]} /></section></div>}
      {!loading && page === 'integrations' && <section className={styles.card}><p className={styles.muted}>ready_to_connect ≠ connected. OAuth is only marked connected after provider consent and readback.</p><DataTable rows={rows.integrations || []} columns={[["Provider",'display_name'],["Type",'provider_type'],["State",'connection_state'],["Scopes",'granted_scopes'],["Verified",'last_verified_at']]} /></section>}
      {!loading && page === 'access' && <><section className={styles.card}><DataTable rows={rows.roles || []} columns={[["Role",'role'],["Description",'description'],["Permissions",row=>Array.isArray(row.permissions)?(row.permissions as unknown[]).slice(0,8).join(', '):'']]} /></section><div className={`${styles.notice} ${styles.good}`}>D’AUBE IT uses passwordless passkey technical access. Business-sensitive permissions are time-bound JIT scopes, not permanent master access.</div></>}
      {!loading && page === 'security' && <div className={styles.grid}><section className={`${styles.card} ${styles.wide}`}><h3>Feature gates</h3><DataTable rows={flags} columns={[["Gate",'key'],["Enabled",row=>String(row.enabled)],["Description",'description']]} /></section><section className={`${styles.card} ${styles.wide}`}><h3>Security events</h3><DataTable rows={rows.security || []} columns={[["Time",'created_at'],["Event",'event_type'],["Severity",'severity'],["Detail",'detail_summary']]} /></section></div>}
      {!loading && page === 'guide' && <div className={styles.grid}><section className={`${styles.card} ${styles.wide}`}><h3>Daily staff flow</h3><p>1. Overview → 2. Classes → 3. Attendance → 4. Student progress → 5. Admissions CRM → 6. Finance reconciliation.</p></section><section className={`${styles.card} ${styles.wide}`}><h3>Safety rules</h3><p>Không chia sẻ tài khoản. Không mở camera/NVR ra Internet. Không bulk-export dữ liệu trẻ em khi không có nghiệp vụ. Báo D’AUBE IT khi có access bất thường.</p></section></div>}
    </main>
  </div>;
}
