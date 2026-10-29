import { useState } from "react";
import { supabase } from "./lib/supabase";

const FONTS = "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap";

const CSS = `
  @import url('${FONTS}');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #050d1f; }

  .login-root {
    min-height: 100vh;
    background: linear-gradient(135deg, #050d1f 0%, #0a1628 50%, #0d1f3c 100%);
    display: flex; align-items: center; justify-content: center;
    font-family: 'Plus Jakarta Sans', sans-serif;
    padding: 24px;
  }

  .login-card {
    background: linear-gradient(160deg, #0d1f3c 0%, #0a1628 100%);
    border: 1px solid #1e3a5f;
    border-radius: 20px;
    padding: 48px 40px;
    width: 100%; max-width: 400px;
    box-shadow: 0 24px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(56,189,248,0.06);
    display: flex; flex-direction: column; align-items: center; gap: 0;
  }

  .login-logo-icon {
    width: 56px; height: 56px; border-radius: 16px;
    background: linear-gradient(135deg, #3b82f6, #38bdf8);
    display: flex; align-items: center; justify-content: center;
    font-weight: 800; font-size: 24px; color: #fff;
    box-shadow: 0 8px 24px rgba(59,130,246,0.5);
    margin-bottom: 16px;
  }

  .login-app-name {
    font-size: 24px; font-weight: 800; letter-spacing: -0.5px;
    background: linear-gradient(135deg, #fff 30%, #38bdf8);
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    margin-bottom: 4px;
  }

  .login-tagline {
    font-size: 13px; color: #475569; font-weight: 500;
    margin-bottom: 40px;
  }

  .login-heading {
    font-size: 18px; font-weight: 700; color: #e2e8f0;
    margin-bottom: 8px; text-align: center;
  }

  .login-sub {
    font-size: 13px; color: #94a3b8; text-align: center;
    margin-bottom: 28px; line-height: 1.6;
  }

  .login-google-btn {
    width: 100%; padding: 13px 20px;
    background: #fff; color: #1f2937;
    border: none; border-radius: 12px; cursor: pointer;
    font-size: 14px; font-weight: 600;
    font-family: 'Plus Jakarta Sans', sans-serif;
    display: flex; align-items: center; justify-content: center; gap: 10px;
    transition: all 0.2s; box-shadow: 0 2px 8px rgba(0,0,0,0.3);
  }
  .login-google-btn:hover:not(:disabled) {
    background: #f9fafb; transform: translateY(-1px);
    box-shadow: 0 6px 20px rgba(0,0,0,0.4);
  }
  .login-google-btn:disabled {
    opacity: 0.7; cursor: not-allowed; transform: none;
  }

  .login-error {
    margin-top: 16px; padding: 10px 14px;
    background: #2d0a0a; border: 1px solid #ef4444;
    border-radius: 8px; color: #f87171;
    font-size: 13px; width: 100%; text-align: center;
  }

  .login-footer {
    margin-top: 32px; font-size: 11px; color: #334155;
    text-align: center; line-height: 1.6;
  }

  .login-divider {
    width: 100%; border: none; border-top: 1px solid #1e3a5f;
    margin: 28px 0;
  }
`;

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
    <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"/>
    <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
    <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
    <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
  </svg>
);

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);

  const signInWithGoogle = async () => {
    if (!supabase) {
      setError("Supabase is not configured. Check your environment variables.");
      return;
    }
    setLoading(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <>
      <style>{CSS}</style>
      <div className="login-root">
        <div className="login-card">
          <div className="login-logo-icon">N</div>
          <div className="login-app-name">Nikadi Studio</div>
          <div className="login-tagline">Card Design &amp; Dispatch</div>

          <div className="login-heading">Welcome back</div>
          <div className="login-sub">
            Sign in to access your events, card designs,<br />and SMS dispatch tools.
          </div>

          <button
            className="login-google-btn"
            onClick={signInWithGoogle}
            disabled={loading}
          >
            <GoogleIcon />
            {loading ? "Redirecting…" : "Continue with Google"}
          </button>

          {error && <div className="login-error">{error}</div>}

          <hr className="login-divider" />
          <div className="login-footer">
            Your data is stored securely in Supabase.<br />
            By signing in you agree to our terms of service.
          </div>
        </div>
      </div>
    </>
  );
}
