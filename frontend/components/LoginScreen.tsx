"use client";

interface LoginScreenProps {
  error?: string | null;
}

export default function LoginScreen({ error }: LoginScreenProps) {
  return (
    <div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a] flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        {/* Logo / branding */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg mb-5">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
              <polyline points="17 6 23 6 23 12" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">Wealth Dashboard</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Your personal AI finance tracker</p>
        </div>

        {/* Card */}
        <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-sm p-8">
          <p className="text-sm text-slate-600 dark:text-slate-300 text-center mb-6 leading-relaxed">
            Sign in with your Google account to access your dashboard.
          </p>

          {error && (
            <div className="mb-5 px-4 py-3 rounded-xl bg-red-50 border border-red-100">
              <p className="text-sm text-red-600 text-center">{error}</p>
            </div>
          )}

          <a
            href="/api/auth/google"
            className="flex items-center justify-center gap-3 w-full py-3.5 px-4 rounded-2xl border-2 border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 hover:bg-slate-50 dark:hover:bg-slate-600 active:scale-95 transition-all font-medium text-slate-700 dark:text-slate-100 text-sm shadow-sm"
          >
            {/* Google logo */}
            <svg width="20" height="20" viewBox="0 0 48 48">
              <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h11.8c-.5 2.7-2 5-4.3 6.5v5.4h7c4.1-3.8 6.6-9.4 6.6-15.9z"/>
              <path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.3l-7-5.4c-2 1.3-4.5 2.1-7.5 2.1-5.8 0-10.7-3.9-12.4-9.1H4.3v5.6C7.9 41.2 15.4 46 24 46z"/>
              <path fill="#FBBC05" d="M11.6 28.3c-.4-1.3-.7-2.7-.7-4.3s.2-3 .7-4.3v-5.6H4.3C2.8 17.1 2 20.4 2 24s.8 6.9 2.3 9.9l7.3-5.6z"/>
              <path fill="#EA4335" d="M24 10.7c3.2 0 6.1 1.1 8.4 3.3l6.3-6.3C34.9 4.2 29.9 2 24 2 15.4 2 7.9 6.8 4.3 14.1l7.3 5.6c1.7-5.2 6.6-9 12.4-9z"/>
            </svg>
            Continue with Google
          </a>
        </div>

        <p className="text-center text-xs text-slate-400 dark:text-slate-500 mt-6">
          Sign in to manage your personal finance dashboard.
        </p>
      </div>
    </div>
  );
}
