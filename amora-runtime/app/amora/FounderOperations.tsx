'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import styles from './FounderOperations.module.css';

type Row = Record<string, unknown>;
type ApiCall = (path: string, init?: RequestInit) => Promise<unknown>;
type Tab = 'control' | 'finance' | 'academics' | 'scholarships' | 'vouchers' | 'payroll' | 'bi' | 'improvements';

const tabs: Array<[Tab, string]> = [
  ['control', 'Control Center'],
  ['finance', 'Học phí & công nợ'],
  ['academics', 'Khoá học'],
  ['scholarships', 'Học bổng'],
  ['vouchers', 'Voucher'],
  ['payroll', 'Payroll'],
  ['bi', 'Data & BI'],
  ['improvements', 'Yêu cầu cải tiến']
];

const money = (v: unknown, currency = 'VND') => new Intl.NumberFormat('vi-VN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number(v || 0));
const text = (v: unknown) => v == null ? '' : Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v);
const num = (v: FormDataEntryValue | null) => Number(String(v || '0').replace(/,/g, ''));
const optNum = (v: FormDataEntryValue | null) => String(v || '').trim() ? Number(String(v)) : null;
const today = () => new Date().toISOString().slice(0, 10);

function downloadCsv(rows: Row[], name: string) {
  const cols = Array.from(new Set(rows.flatMap(row => Object.keys(row))));
  const q = (v: unknown) => '"' + text(v).replace(/"/g, '""') + '"';
  const body = [cols.map(q).join(','), ...rows.map(row => cols.map(col => q(row[col])).join(','))].join('\r\n');
  const url = URL.createObjectURL(new Blob(['\ufeff' + body], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name.replace(/[^a-zA-Z0-9._-]+/g, '-') + '.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Table({ rows, cols }: { rows: Row[]; cols: Array<[string, string]> }) {
  if (!rows.length) return <div className={styles.empty}>Chưa có dữ liệu thật.</div>;
  return <div className={styles.tableWrap}><table><thead><tr>{cols.map(([label]) => <th key={label}>{label}</th>)}</tr></thead><tbody>{rows.map((row, i) => <tr key={i}>{cols.map(([label, key]) => <td key={label}>{text(row[key])}</td>)}</tr>)}</tbody></table></div>;
}

function FormCard({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return <section className={styles.card}><div className={styles.cardHead}><div><h3>{title}</h3>{note && <p>{note}</p>}</div></div>{children}</section>;
}

export function FounderOperations({ api, qa }: { api: ApiCall; qa: boolean }) {
  const [tab, setTab] = useState<Tab>('control');
  const [data, setData] = useState<Record<string, Row[]>>({});
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const get = useCallback(async (table: string, select = '*', query = '') => {
    const result = await api('/rest/v1/' + table + '?select=' + encodeURIComponent(select) + (query ? '&' + query : ''));
    return Array.isArray(result) ? result as Row[] : [];
  }, [api]);

  const post = useCallback(async (table: string, body: Row) => {
    return api('/rest/v1/' + table, { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(body) });
  }, [api]);

  const rpc = useCallback(async (name: string, body: Row) => {
    return api('/rest/v1/rpc/' + name, { method: 'POST', body: JSON.stringify(body) });
  }, [api]);

  const load = useCallback(async () => {
    setError('');
    try {
      const jobs: Array<[string, Promise<Row[]>]> = [
        ['improvements', get('amora_improvement_requests', 'id,title,area,request_type,priority,status,details,desired_outcome,reference_url,created_at', 'test_record=eq.false&order=created_at.desc&limit=50')],
        ['scholarshipPrograms', get('amora_scholarship_programs', 'id,code,name,award_type,award_value,currency,budget_amount,starts_on,ends_on,active', 'test_record=eq.false&order=created_at.desc')],
        ['scholarshipAwards', get('amora_reporting_scholarships_v1', '*', 'order=award_id.desc&limit=100')],
        ['vouchers', get('amora_reporting_vouchers_v1', '*', 'order=voucher_id.desc')],
        ['payrollPeriods', get('amora_payroll_periods', 'id,starts_on,ends_on,status,approved_at', 'test_record=eq.false&order=starts_on.desc&limit=36')],
        ['payrollEntries', get('amora_reporting_payroll_v1', '*', 'order=payroll_period_id.desc,payroll_entry_id.desc&limit=200')],
        ['payrollAdjustments', get('amora_payroll_adjustments', 'id,payroll_entry_id,amount,reason,status,created_at,approved_at', 'test_record=eq.false&order=created_at.desc&limit=100')],
        ['receivables', get('amora_reporting_receivables_v1', '*', 'order=issue_date.desc&limit=200')],
        ['enrollment', get('amora_reporting_enrollment_v1', '*', 'order=enrollment_id.desc&limit=200')],
        ['students', get('amora_students', 'id,student_code,full_name,status', 'test_record=eq.false&order=full_name.asc&limit=500')],
        ['courses', get('amora_courses', 'id,code,title,level,active', 'test_record=eq.false&order=title.asc')],
        ['classes', get('amora_classes', 'id,class_code,course_id,branch_id,capacity,schedule_summary,status', 'test_record=eq.false&order=class_code.asc')],
        ['branches', get('amora_branches', 'id,code,name,active', 'active=eq.true&order=name.asc')],
        ['tuitionPlans', get('amora_tuition_plans', 'id,code,name,billing_model,amount,currency,included_sessions,active', 'test_record=eq.false&order=name.asc')],
        ['tuitionAccounts', get('amora_tuition_accounts', 'id,student_id,enrollment_id,tuition_plan_id,opening_amount,credit_balance,freeze_status,transfer_state', 'test_record=eq.false&order=id.desc&limit=200')],
        ['invoices', get('amora_invoices', 'id,invoice_number,student_id,account_id,total,currency,status,due_date', 'test_record=eq.false&order=id.desc&limit=200')],
        ['staff', get('amora_staff_profiles', 'id,user_id,employee_code,full_name,role_label,employment_status,hourly_rate_reference', 'test_record=eq.false&order=full_name.asc')],
        ['integrations', get('amora_integrations', 'display_name,provider_type,connection_state,granted_scopes,last_verified_at,last_error_summary', 'provider_type=in.(microsoft_graph,power_bi)&order=display_name.asc')]
      ];
      const settled = await Promise.all(jobs.map(async ([key, job]) => [key, await job] as const));
      setData(Object.fromEntries(settled));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [get]);

  useEffect(() => { if (!qa) void load(); }, [load, qa]);

  const run = async (label: string, action: () => Promise<unknown>) => {
    if (qa) return setError('QA mode không ghi dữ liệu production.');
    setBusy(label); setError(''); setNotice('');
    try { await action(); setNotice(label + ' hoàn tất.'); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(''); }
  };

  const metrics = useMemo(() => {
    const receivables = data.receivables || [];
    const payroll = data.payrollEntries || [];
    const awards = data.scholarshipAwards || [];
    const vouchers = data.vouchers || [];
    return {
      outstanding: receivables.reduce((s, r) => s + Number(r.outstanding_amount || 0), 0),
      payroll: payroll.reduce((s, r) => s + Number(r.estimated_total || 0), 0),
      scholarships: awards.reduce((s, r) => s + Number(r.approved_amount || 0), 0),
      activeVouchers: vouchers.filter(r => Boolean(r.active)).length
    };
  }, [data]);

  async function improvementSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const f = new FormData(event.currentTarget);
    await run('Gửi yêu cầu cải tiến', () => rpc('amora_submit_improvement', {
      p_title: String(f.get('title') || ''), p_area: String(f.get('area') || 'other'),
      p_request_type: String(f.get('request_type') || 'improvement'), p_priority: String(f.get('priority') || 'normal'),
      p_details: String(f.get('details') || ''), p_desired_outcome: String(f.get('desired_outcome') || ''),
      p_reference_url: String(f.get('reference_url') || '')
    })); event.currentTarget.reset();
  }

  async function tuitionPlanSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const f = new FormData(event.currentTarget);
    await run('Tạo tuition plan', () => post('amora_tuition_plans', {
      code: String(f.get('code') || '').trim().toUpperCase(), name: String(f.get('name') || '').trim(),
      billing_model: String(f.get('billing_model') || 'monthly'), amount: num(f.get('amount')),
      currency: 'VND', included_sessions: optNum(f.get('included_sessions')), installment_rules: {}, active: true, test_record: false
    })); event.currentTarget.reset();
  }

  async function tuitionAccountSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const f = new FormData(event.currentTarget);
    await run('Tạo tuition account', () => post('amora_tuition_accounts', {
      student_id: num(f.get('student_id')), enrollment_id: optNum(f.get('enrollment_id')),
      tuition_plan_id: num(f.get('tuition_plan_id')), opening_amount: num(f.get('opening_amount')),
      credit_balance: 0, freeze_status: 'active', transfer_state: 'none', test_record: false
    })); event.currentTarget.reset();
  }

  async function invoiceSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const f = new FormData(event.currentTarget); const total = num(f.get('subtotal'));
    await run('Phát hành invoice', () => post('amora_invoices', {
      invoice_number: 'AMORA-' + Date.now(), student_id: num(f.get('student_id')), account_id: num(f.get('account_id')),
      issue_date: today(), due_date: String(f.get('due_date') || '') || null, subtotal: total, discount_total: 0,
      total, currency: 'VND', status: 'issued', test_record: false
    })); event.currentTarget.reset();
  }

  async function paymentSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const f = new FormData(event.currentTarget);
    await run('Ghi nhận thanh toán', () => rpc('amora_record_payment', {
      p_invoice_id: num(f.get('invoice_id')), p_amount: num(f.get('amount')),
      p_method: String(f.get('method') || ''), p_provider_reference: String(f.get('reference') || '')
    })); event.currentTarget.reset();
  }

  async function courseSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const f = new FormData(event.currentTarget);
    await run('Tạo khoá học', () => post('amora_courses', {
      code: String(f.get('code') || '').trim().toUpperCase(), title: String(f.get('title') || '').trim(),
      level: String(f.get('level') || '').trim(), description: String(f.get('description') || '').trim(), active: true, test_record: false
    })); event.currentTarget.reset();
  }

  async function classSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const f = new FormData(event.currentTarget);
    await run('Tạo lớp học', () => post('amora_classes', {
      class_code: String(f.get('class_code') || '').trim().toUpperCase(), course_id: num(f.get('course_id')),
      branch_id: optNum(f.get('branch_id')), capacity: optNum(f.get('capacity')),
      schedule_summary: String(f.get('schedule_summary') || '').trim(), status: 'planned', assistant_user_ids: [], test_record: false
    })); event.currentTarget.reset();
  }

  async function enrollmentSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const f = new FormData(event.currentTarget);
    await run('Ghi danh học viên', () => post('amora_enrollments', {
      student_id: num(f.get('student_id')), class_id: num(f.get('class_id')), start_date: String(f.get('start_date') || '') || today(),
      tuition_plan_id: optNum(f.get('tuition_plan_id')), status: 'active', test_record: false
    })); event.currentTarget.reset();
  }

  async function scholarshipProgramSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const f = new FormData(event.currentTarget);
    await run('Tạo chương trình học bổng', () => post('amora_scholarship_programs', {
      code: String(f.get('code') || '').trim().toUpperCase(), name: String(f.get('name') || '').trim(),
      description: String(f.get('description') || '').trim(), award_type: String(f.get('award_type') || 'fixed'),
      award_value: num(f.get('award_value')), currency: 'VND', budget_amount: optNum(f.get('budget_amount')),
      starts_on: String(f.get('starts_on') || '') || null, ends_on: String(f.get('ends_on') || '') || null,
      eligibility_rules: {}, active: true, approval_required: true, test_record: false
    })); event.currentTarget.reset();
  }

  async function scholarshipAwardSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const f = new FormData(event.currentTarget); const programId = num(f.get('program_id'));
    const program = (data.scholarshipPrograms || []).find(row => Number(row.id) === programId);
    if (!program) return setError('Chọn chương trình học bổng.');
    await run('Tạo hồ sơ học bổng', () => post('amora_scholarship_awards', {
      program_id: programId, student_id: num(f.get('student_id')), enrollment_id: optNum(f.get('enrollment_id')),
      status: 'pending', award_type: program.award_type, award_value: program.award_value, approved_amount: 0, applied_amount: 0,
      currency: program.currency || 'VND', starts_on: program.starts_on || null, ends_on: program.ends_on || null,
      reason: String(f.get('reason') || '').trim(), test_record: false
    })); event.currentTarget.reset();
  }

  async function scholarshipApprove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const f = new FormData(event.currentTarget);
    await run('Phê duyệt học bổng', () => rpc('amora_approve_scholarship_award', {
      p_award_id: num(f.get('award_id')), p_approved_amount: optNum(f.get('approved_amount'))
    })); event.currentTarget.reset();
  }

  async function scholarshipApply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const f = new FormData(event.currentTarget);
    await run('Áp dụng học bổng vào invoice', () => rpc('amora_apply_scholarship_to_invoice', {
      p_award_id: num(f.get('award_id')), p_invoice_id: num(f.get('invoice_id')), p_amount: optNum(f.get('amount'))
    })); event.currentTarget.reset();
  }

  async function voucherSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const f = new FormData(event.currentTarget);
    await run('Tạo voucher', () => post('amora_vouchers', {
      code: String(f.get('code') || '').trim().toUpperCase(), name: String(f.get('name') || '').trim(),
      description: String(f.get('description') || '').trim(), discount_type: String(f.get('discount_type') || 'fixed'),
      discount_value: num(f.get('discount_value')), currency: 'VND',
      starts_at: String(f.get('starts_at') || '') || null, ends_at: String(f.get('ends_at') || '') || null,
      usage_limit: optNum(f.get('usage_limit')), per_student_limit: Number(f.get('per_student_limit') || 1),
      stackable: f.get('stackable') === 'on', eligibility_rules: {}, active: true, test_record: false
    })); event.currentTarget.reset();
  }

  async function voucherRedeem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const f = new FormData(event.currentTarget);
    await run('Áp dụng voucher', () => rpc('amora_redeem_voucher', {
      p_code: String(f.get('code') || '').trim(), p_invoice_id: num(f.get('invoice_id'))
    })); event.currentTarget.reset();
  }

  async function payrollPeriodSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const f = new FormData(event.currentTarget);
    await run('Tạo kỳ payroll', () => post('amora_payroll_periods', {
      starts_on: String(f.get('starts_on') || ''), ends_on: String(f.get('ends_on') || ''), status: 'draft', test_record: false
    })); event.currentTarget.reset();
  }

  async function payrollEntrySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const f = new FormData(event.currentTarget);
    await run('Tạo payroll entry', () => post('amora_payroll_entries', {
      payroll_period_id: num(f.get('payroll_period_id')), staff_user_id: String(f.get('staff_user_id') || '') || null,
      teaching_minutes: Number(f.get('teaching_minutes') || 0), gross_reference: optNum(f.get('gross_reference')),
      adjustments: 0, status: 'review', test_record: false
    })); event.currentTarget.reset();
  }

  async function payrollAdjustmentSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const f = new FormData(event.currentTarget);
    await run('Tạo payroll adjustment', () => post('amora_payroll_adjustments', {
      payroll_entry_id: num(f.get('payroll_entry_id')), amount: num(f.get('amount')),
      reason: String(f.get('reason') || '').trim(), status: 'requested', test_record: false
    })); event.currentTarget.reset();
  }

  const students = data.students || [], programs = data.scholarshipPrograms || [], invoices = data.invoices || [];
  const tuitionPlans = data.tuitionPlans || [], classes = data.classes || [], branches = data.branches || [];
  const staff = (data.staff || []).filter(row => row.user_id);

  return <div className={styles.root}>
    <header className={styles.hero}>
      <div><span>FOUNDER CONTROL CENTER</span><h2>AMORA Operations Studio</h2><p>Founder & Co-Founder quản trị học phí, công nợ, lớp học, học bổng, voucher, payroll, dữ liệu và backlog từ một nơi. Mọi write-path đều đi qua RLS hoặc RPC có kiểm soát.</p></div>
      <button onClick={() => void load()} disabled={busy !== ''}>Refresh data</button>
    </header>

    <div className={styles.metrics}>
      <div><span>Công nợ mở</span><strong>{money(metrics.outstanding)}</strong></div>
      <div><span>Payroll dự tính</span><strong>{money(metrics.payroll)}</strong></div>
      <div><span>Học bổng đã duyệt</span><strong>{money(metrics.scholarships)}</strong></div>
      <div><span>Voucher active</span><strong>{metrics.activeVouchers}</strong></div>
    </div>

    <nav className={styles.tabs}>{tabs.map(([id,label]) => <button key={id} className={tab === id ? styles.active : ''} onClick={() => setTab(id)}>{label}</button>)}</nav>
    {error && <div className={styles.error}>{error}</div>}
    {notice && <div className={styles.success}>{notice}</div>}
    {busy && <div className={styles.busy}>{busy}…</div>}

    {tab === 'control' && <div className={styles.grid}>
      <FormCard title="Executive operating model" note="Single source of truth · controlled writes · audit trail">
        <ul className={styles.rules}><li>PostgreSQL/Supabase là canonical operational data plane.</li><li>Founder/Co-Founder có business control; D’AUBE IT không nhận quyền thanh toán hay duyệt lương mặc định.</li><li>Không đưa service-role key vào client. RLS và RPC kiểm tra quyền ở database.</li><li>Power BI/Office chỉ kết nối sau khi Founder tự authorize Microsoft account.</li></ul>
      </FormCard>
      <FormCard title="Microsoft & Power BI readiness" note="Không giả lập trạng thái connected">
        <Table rows={data.integrations || []} cols={[[ 'Tool','display_name'],['Provider','provider_type'],['State','connection_state'],['Verified','last_verified_at']]} />
        <div className={styles.actions}><a href="https://app.powerbi.com/" target="_blank" rel="noreferrer">Open Power BI</a><a href="/studio" target="_blank" rel="noreferrer">D’AUBE Document Studio</a></div>
      </FormCard>
    </div>}

    {tab === 'finance' && <div className={styles.grid}>
      <FormCard title="Tuition plan"><form onSubmit={tuitionPlanSubmit} className={styles.form}><input name="code" required placeholder="Mã plan"/><input name="name" required placeholder="Tên plan"/><select name="billing_model"><option value="monthly">Monthly</option><option value="installment">Installment</option><option value="package">Package</option><option value="session_count">Session count</option></select><input name="amount" type="number" min="0" required placeholder="Học phí"/><input name="included_sessions" type="number" min="0" placeholder="Số buổi"/><button disabled={!!busy}>Tạo plan</button></form></FormCard>
      <FormCard title="Tuition account"><form onSubmit={tuitionAccountSubmit} className={styles.form}><select name="student_id" required>{students.map(r=><option key={String(r.id)} value={String(r.id)}>{text(r.student_code)} · {text(r.full_name)}</option>)}</select><input name="enrollment_id" type="number" placeholder="Enrollment ID (optional)"/><select name="tuition_plan_id" required>{tuitionPlans.map(r=><option key={String(r.id)} value={String(r.id)}>{text(r.code)} · {text(r.name)}</option>)}</select><input name="opening_amount" type="number" min="0" required placeholder="Opening amount"/><button disabled={!!busy}>Tạo account</button></form></FormCard>
      <FormCard title="Phát hành invoice"><form onSubmit={invoiceSubmit} className={styles.form}><select name="student_id" required>{students.map(r=><option key={String(r.id)} value={String(r.id)}>{text(r.student_code)} · {text(r.full_name)}</option>)}</select><input name="account_id" type="number" required placeholder="Tuition account ID"/><input name="subtotal" type="number" min="0" required placeholder="Subtotal"/><input name="due_date" type="date"/><button disabled={!!busy}>Issue invoice</button></form></FormCard>
      <FormCard title="Ghi nhận payment" note="RPC khóa invoice, chặn overpayment và ghi ledger atomically."><form onSubmit={paymentSubmit} className={styles.form}><select name="invoice_id" required>{invoices.map(r=><option key={String(r.id)} value={String(r.id)}>{text(r.invoice_number)} · {money(r.total, text(r.currency)||'VND')}</option>)}</select><input name="amount" type="number" min="1" required placeholder="Số tiền"/><input name="method" placeholder="VietQR / cash / transfer"/><input name="reference" placeholder="Mã đối soát"/><button disabled={!!busy}>Record payment</button></form></FormCard>
      <FormCard title="Receivables ledger"><Table rows={data.receivables || []} cols={[[ 'Invoice','invoice_number'],['Học viên','student_name'],['Due','due_date'],['Total','total'],['Paid','paid_amount'],['Outstanding','outstanding_amount'],['Status','status']]} /></FormCard>
    </div>}

    {tab === 'academics' && <div className={styles.grid}>
      <FormCard title="Tạo khoá học"><form onSubmit={courseSubmit} className={styles.form}><input name="code" required placeholder="A2-MOVERS"/><input name="title" required placeholder="Tên khoá học"/><input name="level" placeholder="Cambridge level"/><textarea name="description" placeholder="Mô tả"/><button disabled={!!busy}>Tạo course</button></form></FormCard>
      <FormCard title="Tạo lớp"><form onSubmit={classSubmit} className={styles.form}><input name="class_code" required placeholder="MOVERS-02"/><select name="course_id" required>{(data.courses||[]).map(r=><option key={String(r.id)} value={String(r.id)}>{text(r.code)} · {text(r.title)}</option>)}</select><select name="branch_id"><option value="">Chưa gán cơ sở</option>{branches.map(r=><option key={String(r.id)} value={String(r.id)}>{text(r.name)}</option>)}</select><input name="capacity" type="number" min="1" placeholder="Capacity"/><input name="schedule_summary" placeholder="T3 · T5 · 18:00"/><button disabled={!!busy}>Tạo class</button></form></FormCard>
      <FormCard title="Ghi danh"><form onSubmit={enrollmentSubmit} className={styles.form}><select name="student_id" required>{students.map(r=><option key={String(r.id)} value={String(r.id)}>{text(r.student_code)} · {text(r.full_name)}</option>)}</select><select name="class_id" required>{classes.map(r=><option key={String(r.id)} value={String(r.id)}>{text(r.class_code)}</option>)}</select><select name="tuition_plan_id"><option value="">Chưa gán tuition plan</option>{tuitionPlans.map(r=><option key={String(r.id)} value={String(r.id)}>{text(r.code)} · {text(r.name)}</option>)}</select><input name="start_date" type="date" defaultValue={today()}/><button disabled={!!busy}>Enroll</button></form></FormCard>
      <FormCard title="Enrollment dataset"><Table rows={data.enrollment || []} cols={[[ 'Student','student_name'],['Course','course_name'],['Class','class_code'],['Plan','tuition_plan_name'],['Status','status'],['Start','start_date']]} /></FormCard>
    </div>}

    {tab === 'scholarships' && <div className={styles.grid}>
      <FormCard title="Chương trình học bổng"><form onSubmit={scholarshipProgramSubmit} className={styles.form}><input name="code" required placeholder="MERIT-2026"/><input name="name" required placeholder="Tên chương trình"/><textarea name="description" placeholder="Mục tiêu và điều kiện"/><select name="award_type"><option value="fixed">Fixed amount</option><option value="percent">Percent</option></select><input name="award_value" type="number" min="0" required placeholder="Giá trị"/><input name="budget_amount" type="number" min="0" placeholder="Ngân sách tối đa"/><input name="starts_on" type="date"/><input name="ends_on" type="date"/><button disabled={!!busy}>Tạo chương trình</button></form></FormCard>
      <FormCard title="Cấp học bổng"><form onSubmit={scholarshipAwardSubmit} className={styles.form}><select name="program_id" required>{programs.map(r=><option key={String(r.id)} value={String(r.id)}>{text(r.code)} · {text(r.name)}</option>)}</select><select name="student_id" required>{students.map(r=><option key={String(r.id)} value={String(r.id)}>{text(r.student_code)} · {text(r.full_name)}</option>)}</select><input name="enrollment_id" type="number" placeholder="Enrollment ID"/><textarea name="reason" placeholder="Lý do / evidence"/><button disabled={!!busy}>Submit award</button></form></FormCard>
      <FormCard title="Phê duyệt học bổng"><form onSubmit={scholarshipApprove} className={styles.form}><input name="award_id" type="number" required placeholder="Award ID"/><input name="approved_amount" type="number" min="0" placeholder="Approved amount (percent awards require value)"/><button disabled={!!busy}>Approve</button></form></FormCard>
      <FormCard title="Áp dụng vào học phí"><form onSubmit={scholarshipApply} className={styles.form}><input name="award_id" type="number" required placeholder="Award ID"/><select name="invoice_id" required>{invoices.map(r=><option key={String(r.id)} value={String(r.id)}>{text(r.invoice_number)}</option>)}</select><input name="amount" type="number" min="0" placeholder="Amount (blank = available)"/><button disabled={!!busy}>Apply to invoice</button></form></FormCard>
      <FormCard title="Scholarship ledger"><Table rows={data.scholarshipAwards || []} cols={[[ 'Award','award_id'],['Program','program_name'],['Student','student_name'],['Status','status'],['Approved','approved_amount'],['Applied','applied_amount']]} /></FormCard>
    </div>}

    {tab === 'vouchers' && <div className={styles.grid}>
      <FormCard title="Tạo voucher"><form onSubmit={voucherSubmit} className={styles.form}><input name="code" required placeholder="WELCOME2026"/><input name="name" required placeholder="Tên voucher"/><textarea name="description" placeholder="Điều kiện sử dụng"/><select name="discount_type"><option value="fixed">Fixed amount</option><option value="percent">Percent</option></select><input name="discount_value" type="number" min="0" required placeholder="Giá trị"/><input name="starts_at" type="datetime-local"/><input name="ends_at" type="datetime-local"/><input name="usage_limit" type="number" min="1" placeholder="Tổng lượt dùng"/><input name="per_student_limit" type="number" min="1" defaultValue="1"/><label className={styles.checkbox}><input name="stackable" type="checkbox"/> Cho phép stack</label><button disabled={!!busy}>Tạo voucher</button></form></FormCard>
      <FormCard title="Redeem voucher" note="RPC kiểm soát validity, usage caps, stacking, invoice total và ledger."><form onSubmit={voucherRedeem} className={styles.form}><input name="code" required placeholder="Voucher code"/><select name="invoice_id" required>{invoices.map(r=><option key={String(r.id)} value={String(r.id)}>{text(r.invoice_number)} · {money(r.total)}</option>)}</select><button disabled={!!busy}>Apply voucher</button></form></FormCard>
      <FormCard title="Voucher analytics"><Table rows={data.vouchers || []} cols={[[ 'Code','code'],['Name','name'],['Type','discount_type'],['Value','discount_value'],['Usage','applied_count'],['Redeemed','redeemed_total'],['Active','active']]} /></FormCard>
    </div>}

    {tab === 'payroll' && <div className={styles.grid}>
      <FormCard title="Tạo kỳ payroll"><form onSubmit={payrollPeriodSubmit} className={styles.form}><input name="starts_on" type="date" required/><input name="ends_on" type="date" required/><button disabled={!!busy}>Tạo period</button></form></FormCard>
      <FormCard title="Payroll entry"><form onSubmit={payrollEntrySubmit} className={styles.form}><select name="payroll_period_id" required>{(data.payrollPeriods||[]).map(r=><option key={String(r.id)} value={String(r.id)}>{text(r.starts_on)} → {text(r.ends_on)} · {text(r.status)}</option>)}</select><select name="staff_user_id" required>{staff.map(r=><option key={String(r.user_id)} value={String(r.user_id)}>{text(r.employee_code)} · {text(r.full_name)}</option>)}</select><input name="teaching_minutes" type="number" min="0" required placeholder="Teaching minutes"/><input name="gross_reference" type="number" min="0" placeholder="Gross reference"/><button disabled={!!busy}>Tạo entry</button></form></FormCard>
      <FormCard title="Adjustment request"><form onSubmit={payrollAdjustmentSubmit} className={styles.form}><input name="payroll_entry_id" type="number" required placeholder="Payroll entry ID"/><input name="amount" type="number" required placeholder="+/- adjustment"/><textarea name="reason" required placeholder="Lý do"/><button disabled={!!busy}>Request adjustment</button></form></FormCard>
      <FormCard title="Pending adjustments">{(data.payrollAdjustments||[]).map(row=><div className={styles.approval} key={String(row.id)}><div><strong>#{text(row.id)} · {money(row.amount)}</strong><span>{text(row.reason)} · {text(row.status)}</span></div>{row.status === 'requested' && <div><button onClick={() => void run('Approve adjustment', () => rpc('amora_approve_payroll_adjustment', { p_adjustment_id: Number(row.id), p_approve: true }))}>Approve</button><button onClick={() => void run('Reject adjustment', () => rpc('amora_approve_payroll_adjustment', { p_adjustment_id: Number(row.id), p_approve: false }))}>Reject</button></div>}</div>)}</FormCard>
      <FormCard title="Payroll periods">{(data.payrollPeriods||[]).map(row=><div className={styles.approval} key={String(row.id)}><div><strong>{text(row.starts_on)} → {text(row.ends_on)}</strong><span>{text(row.status)}</span></div>{['draft','review'].includes(text(row.status)) && <button onClick={() => void run('Approve payroll period', () => rpc('amora_approve_payroll_period', { p_period_id: Number(row.id) }))}>Approve period</button>}</div>)}</FormCard>
      <FormCard title="Payroll dataset"><Table rows={data.payrollEntries || []} cols={[[ 'Entry','payroll_entry_id'],['Staff','staff_name'],['Period','payroll_period_id'],['Minutes','teaching_minutes'],['Gross','gross_reference'],['Adjust','adjustments'],['Estimated','estimated_total'],['Status','entry_status']]} /></FormCard>
    </div>}

    {tab === 'bi' && <div className={styles.grid}>
      <FormCard title="Curated reporting datasets" note="Các view dùng security_invoker, không bypass RLS.">
        <div className={styles.exportGrid}>
          {[
            ['Receivables', data.receivables || [], 'amora-receivables'],
            ['Enrollment', data.enrollment || [], 'amora-enrollment'],
            ['Scholarships', data.scholarshipAwards || [], 'amora-scholarships'],
            ['Vouchers', data.vouchers || [], 'amora-vouchers'],
            ['Payroll', data.payrollEntries || [], 'amora-payroll']
          ].map(([label,rows,name])=><button key={String(label)} onClick={() => downloadCsv(rows as Row[], String(name))}>Export {String(label)} CSV</button>)}
        </div>
        <p className={styles.muted}>CSV là data-exchange layer ổn định cho Excel/Power BI. Microsoft 365 và Power BI đang ở trạng thái ready_to_connect cho đến khi Founder tự authorize tài khoản.</p>
      </FormCard>
      <FormCard title="Office & document tools">
        <div className={styles.actions}><button onClick={() => window.print()}>Print / Save PDF</button><a href="/studio" target="_blank" rel="noreferrer">Word · Excel · PowerPoint · PDF Studio</a><a href="https://www.office.com/" target="_blank" rel="noreferrer">Microsoft 365</a><a href="https://app.powerbi.com/" target="_blank" rel="noreferrer">Power BI</a></div>
        <p className={styles.muted}>D’AUBE Document Studio là artifact engine riêng; dữ liệu học viên không tự động gửi sang AI. Founder chủ động chọn dữ liệu nào được dùng để tạo tài liệu.</p>
      </FormCard>
    </div>}

    {tab === 'improvements' && <div className={styles.grid}>
      <FormCard title="Phương muốn AMORA cải tiến gì?" note="Yêu cầu đi thẳng vào backlog có audit trail.">
        <form onSubmit={improvementSubmit} className={styles.form}><input name="title" required minLength={4} placeholder="Tên nhu cầu"/><div className={styles.row}><select name="area"><option value="website">Website & UX</option><option value="students">Học viên</option><option value="tuition_finance">Học phí / tài chính</option><option value="courses">Khoá học</option><option value="scholarships_vouchers">Học bổng / voucher</option><option value="payroll_hr">Payroll / HR</option><option value="reports_bi">Reports / BI</option><option value="documents">Documents</option><option value="integrations">Integrations</option><option value="security">Security</option><option value="other">Khác</option></select><select name="request_type"><option value="improvement">Cải tiến</option><option value="feature">Tính năng mới</option><option value="automation">Automation</option><option value="report">Dashboard/report</option><option value="integration">Integration</option><option value="content">Content</option><option value="bug">Bug</option><option value="other">Khác</option></select><select name="priority"><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option><option value="low">Low</option></select></div><textarea name="details" required minLength={10} placeholder="Quy trình hiện tại, vấn đề, dữ liệu cần xem/nhập, người sử dụng…"/><input name="desired_outcome" placeholder="Kết quả mong muốn"/><input name="reference_url" type="url" placeholder="Link tham khảo"/><button disabled={!!busy}>Gửi vào product backlog</button></form>
      </FormCard>
      <FormCard title="Founder backlog"><Table rows={data.improvements || []} cols={[[ 'ID','id'],['Title','title'],['Area','area'],['Type','request_type'],['Priority','priority'],['Status','status'],['Created','created_at']]} /></FormCard>
    </div>}
  </div>;
}
