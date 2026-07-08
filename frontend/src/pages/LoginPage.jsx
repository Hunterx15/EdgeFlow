/**
 * EdgeFlow - Login page
 */

import React from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Mail, Lock, Loader2, Sparkles } from 'lucide-react';
import { Logo } from '../components/layout/Logo';

export default function LoginPage() {
  const { login, user, loading } = useAuth();
  const navigate = useNavigate();

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm({
    defaultValues: {
      email: '',
      password: '',
    },
  });

  if (!loading && user) {
    return <Navigate to="/" replace />;
  }

  const onSubmit = async (values) => {
    try {
      await login(values.email, values.password);
      navigate('/', { replace: true });
    } catch {}
  };

  const fillDemoCredentials = () => {
    setValue('email', 'admin@edgeflow.dev');
    setValue('password', 'Admin@12345');
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-slate-950 relative overflow-hidden">
      {/* Background Glow */}
      <div
        className="absolute inset-0 opacity-30 pointer-events-none"
        style={{
          backgroundImage:
            'radial-gradient(circle at 20% 20%, rgba(34,211,238,0.15), transparent 40%), radial-gradient(circle at 80% 70%, rgba(14,165,233,0.1), transparent 40%)',
        }}
      />

      {/* Grid */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage:
            'linear-gradient(rgba(30,41,59,0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(30,41,59,0.4) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
          maskImage: 'radial-gradient(circle at center, black, transparent 70%)',
        }}
      />

      <div className="relative w-full max-w-md animate-fade-in">
        {/* Header */}
        <div className="text-center mb-8">
          <div
            className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4"
            style={{
              background: '#083344',
              border: '1px solid #155e75',
            }}
          >
            <Logo size={28} />
          </div>

          <h1 className="text-2xl font-bold text-slate-100">
            Welcome to EdgeFlow
          </h1>

          <p className="text-sm text-slate-500 mt-1">
            Sign in to your admin dashboard
          </p>
        </div>

        {/* Login Card */}
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="card p-6 space-y-5"
        >
          {/* Email */}
          <div>
            <label className="label">Email</label>

            <div className="relative">
              <Mail
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
              />

              <input
                type="email"
                placeholder="you@example.com"
                autoComplete="email"
                className="input pl-9"
                {...register('email', {
                  required: 'Email is required',
                })}
              />
            </div>

            {errors.email && (
              <p className="text-xs text-rose-400 mt-1">
                {errors.email.message}
              </p>
            )}
          </div>

          {/* Password */}
          <div>
            <label className="label">Password</label>

            <div className="relative">
              <Lock
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
              />

              <input
                type="password"
                placeholder="••••••••"
                autoComplete="current-password"
                className="input pl-9"
                {...register('password', {
                  required: 'Password is required',
                })}
              />
            </div>

            {errors.password && (
              <p className="text-xs text-rose-400 mt-1">
                {errors.password.message}
              </p>
            )}
          </div>

          {/* Login Button */}
          <button
            type="submit"
            disabled={isSubmitting}
            className="btn-primary w-full justify-center"
          >
            {isSubmitting ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                <span>Signing in...</span>
              </>
            ) : (
              'Sign In'
            )}
          </button>

          {/* Demo Access */}
          <div className="border-t border-slate-800 pt-5">
            <div className="rounded-xl border border-cyan-900/50 bg-cyan-950/20 p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="flex items-center gap-2 text-sm font-semibold text-cyan-300">
                    <Sparkles size={16} />
                    Demo Access
                  </p>

                  <p className="mt-1 text-xs text-slate-400 leading-5">
                    Want to explore EdgeFlow?
                    <br />
                    Click below to automatically fill the demo administrator
                    credentials.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={fillDemoCredentials}
                  className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-cyan-500 active:scale-95"
                >
                  Use Demo
                </button>
              </div>
            </div>
          </div>
        </form>

        {/* Footer */}
        <p className="text-center text-xs text-slate-600 mt-6">
          EdgeFlow · High-Performance API Gateway
        </p>
      </div>
    </div>
  );
}