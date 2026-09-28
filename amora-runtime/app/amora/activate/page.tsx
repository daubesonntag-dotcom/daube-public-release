'use client';

import { FormEvent, useEffect, useState } from 'react';
import { TurnstileField, turnstileConfigured } from '@/components/turnstile-field';

const SUPABASE_URL = 'https://wilqsqndjgckqxbjptxm.supabase.co';
const PUBLISHABLE_KEY = 'sb_publishable_ynfcB4JbyYhNhkPkPBc4wg_3ZPF0gl6';
const AMORA_LIVE_URL = `${SUPABASE_URL}/functions/v1/founder-os-shell/amora`;

export default function AmoraActivatePage() {
  const [inviteToken, setInviteToken] = useState('');
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaResetKey, setCaptchaResetKey] = useState(0);
  const [status, setStatus] = useState<'ready' | 'busy' | 'success' | 'error'>('ready');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const url = new URL(window.location.href);
    const token = url.searchParams.get('token') || '';
    setInviteToken(token);
    if (token) {
      url.searchParams.delete('token');
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    }
  }, []);

  async function activate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('');

    if (inviteToken.length < 32) {
      setStatus('error');
      setMessage('Liên kết kích hoạt không hợp lệ hoặc đã bị xóa khỏi phiên này. Hãy mở lại liên kết một lần từ Founder/D’AUBE IT.');
      return;
    }

    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') || '').trim().toLowerCase();
    const password = String(form.get('password') || '');
    const confirmPassword = String(form.get('confirmPassword') || '');

    if (!email || !email.includes('@')) {
      setStatus('error');
      setMessage('Nhập email hợp lệ.');
      return;
    }
    if (password.length < 10) {
      setStatus('error');
      setMessage('Mật khẩu cần ít nhất 10 ký tự.');
      return;
    }
    if (password !== confirmPassword) {
      setStatus('error');
      setMessage('Hai mật khẩu chưa khớp.');
      return;
    }
    if (turnstileConfigured() && !captchaToken) {
      setStatus('error');
      setMessage('Hãy hoàn tất xác minh chống bot.');
      return;
    }

    setStatus('busy');
    try {
      const response = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
        method: 'POST',
        headers: {
          apikey: PUBLISHABLE_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email,
          password,
          data: {
            amora_context: 'native_invite',
            amora_invite_token: inviteToken
          },
          gotrue_meta_security: captchaToken ? { captcha_token: captchaToken } : undefined
        })
      });

      const raw = await response.text();
      let body: Record<string, unknown> = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }

      if (!response.ok) {
        const detail = String(body.message || body.error_description || body.msg || raw || `HTTP ${response.status}`);
        throw new Error(detail);
      }

      setInviteToken('');
      setStatus('success');
      const hasSession = Boolean(body.access_token);
      setMessage(hasSession
        ? 'Tài khoản Founder AMORA đã được kích hoạt. Bạn có thể mở AMORA OS và đăng nhập ngay.'
        : 'Tài khoản đã được tạo. Nếu hệ thống yêu cầu xác nhận email, hãy xác nhận email trước rồi đăng nhập AMORA OS.');
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setCaptchaToken('');
      setCaptchaResetKey(value => value + 1);
    }
  }

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: 'linear-gradient(145deg,#fff9fb,#fff6f8 55%,#fff)', color: '#371b26', fontFamily: 'Inter,system-ui,-apple-system,Segoe UI,sans-serif' }}>
      <section style={{ width: 'min(500px,100%)', background: '#fff', border: '1px solid #f0d5de', borderRadius: 24, padding: 28, boxShadow: '0 28px 80px rgba(122,30,58,.14)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
          <div style={{ width: 44, height: 44, borderRadius: 15, display: 'grid', placeItems: 'center', background: 'linear-gradient(145deg,#c74b74,#7a1e3a)', color: '#fff', fontWeight: 900 }}>A</div>
          <div><h1 style={{ margin: 0, color: '#7a1e3a', fontFamily: 'Georgia,serif' }}>Activate AMORA Founder</h1><small style={{ color: '#886676' }}>One-time protected account setup</small></div>
        </div>

        <p style={{ color: '#886676', lineHeight: 1.6 }}>Thiết lập email và mật khẩu riêng cho tài khoản Founder. Quyền Founder được lấy từ lời mời phía máy chủ — trang này không cho phép tự chọn role.</p>

        {status !== 'success' ? (
          <form onSubmit={activate}>
            {['email', 'password', 'confirmPassword'].map((name) => (
              <label key={name} style={{ display: 'grid', gap: 6, margin: '12px 0', fontSize: 12, fontWeight: 800, color: '#765263' }}>
                {name === 'email' ? 'Email' : name === 'password' ? 'Mật khẩu' : 'Nhập lại mật khẩu'}
                <input name={name} type={name === 'email' ? 'email' : 'password'} autoComplete={name === 'email' ? 'email' : name === 'password' ? 'new-password' : 'new-password'} required style={{ border: '1px solid #ead1da', borderRadius: 12, padding: '11px 12px', background: '#fffdfd' }} />
              </label>
            ))}
            <TurnstileField action="amora-activate" onToken={setCaptchaToken} resetKey={captchaResetKey} />
            <button disabled={status === 'busy' || !inviteToken || (turnstileConfigured() && !captchaToken)} style={{ width: '100%', border: 0, borderRadius: 12, padding: '11px 14px', marginTop: 8, background: '#c74b74', color: '#fff', fontWeight: 800, cursor: 'pointer', opacity: status === 'busy' || !inviteToken ? .55 : 1 }}>
              {status === 'busy' ? 'Đang kích hoạt…' : inviteToken ? 'Kích hoạt Founder' : 'Liên kết không hợp lệ'}
            </button>
          </form>
        ) : (
          <a href={AMORA_LIVE_URL} style={{ display: 'block', textAlign: 'center', borderRadius: 12, padding: '11px 14px', background: '#7a1e3a', color: '#fff', textDecoration: 'none', fontWeight: 800 }}>Mở AMORA OS</a>
        )}

        {message && <div role="status" style={{ marginTop: 12, padding: '12px 14px', borderRadius: 12, background: status === 'error' ? '#fff0f2' : '#eef9f4', border: `1px solid ${status === 'error' ? '#f5c7cf' : '#cce9dc'}`, color: status === 'error' ? '#963b4a' : '#28614f', fontSize: 12, lineHeight: 1.5 }}>{message}</div>}

        <div style={{ marginTop: 14, padding: '12px 14px', borderRadius: 12, background: '#fff8e8', border: '1px solid #f3ddb6', color: '#7d5b26', fontSize: 12, lineHeight: 1.5 }}>
          <b>D’AUBE SONNTAG IT không dùng trang này.</b> IT vẫn dùng passkey/passwordless và JIT support scope. Không có master password hay backdoor.
        </div>
      </section>
    </main>
  );
}
