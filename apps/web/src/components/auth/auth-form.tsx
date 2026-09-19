'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth/auth-provider';
import { safeRedirectPath } from '../../lib/auth/safe-redirect';

type Mode = 'login' | 'register';
type Field = 'email' | 'password';
type FieldErrors = Partial<Record<Field, string>>;

const PASSWORD_MIN = 10;
const PASSWORD_MAX = 128;

const copy = {
  login: {
    title: 'Ingresá a tu cuenta',
    lead: 'Retomá tus compras donde las dejaste.',
    submit: 'Ingresar',
    pending: 'Ingresando…',
    passwordAutocomplete: 'current-password',
    switchText: '¿Todavía no tenés cuenta?',
    switchLink: 'Creá una',
    switchHref: '/register',
  },
  register: {
    title: 'Creá tu cuenta',
    lead: 'Es gratis. Solo necesitás un email y una contraseña.',
    submit: 'Crear cuenta',
    pending: 'Creando tu cuenta…',
    passwordAutocomplete: 'new-password',
    switchText: '¿Ya tenés cuenta?',
    switchLink: 'Ingresá',
    switchHref: '/login',
  },
} as const;

function validate(mode: Mode, email: string, password: string): FieldErrors {
  const errors: FieldErrors = {};
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errors.email = 'Ingresá un email válido, por ejemplo nombre@correo.com.';
  if (mode === 'register' && (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX)) {
    errors.password = `La contraseña debe tener entre ${PASSWORD_MIN} y ${PASSWORD_MAX} caracteres.`;
  } else if (!password) {
    errors.password = 'Ingresá tu contraseña.';
  }
  return errors;
}

function serverFieldErrors(mode: Mode, fields: readonly string[]): FieldErrors {
  const errors: FieldErrors = {};
  if (fields.includes('email')) errors.email = 'Revisá el email.';
  if (fields.includes('password')) {
    errors.password = mode === 'register'
      ? `La contraseña debe tener entre ${PASSWORD_MIN} y ${PASSWORD_MAX} caracteres.`
      : 'Revisá la contraseña.';
  }
  return errors;
}

export function AuthForm({ mode }: { mode: Mode }) {
  const text = copy[mode];
  const { state, login, register } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeRedirectPath(searchParams.get('next'));
  const id = useId();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const alertRef = useRef<HTMLDivElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  // Con sesión activa no tiene sentido mostrar el formulario.
  useEffect(() => {
    if (state.status === 'authenticated' && !pending) router.replace(next);
  }, [state.status, pending, router, next]);

  useEffect(() => {
    if (formError) alertRef.current?.focus();
  }, [formError]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setFormError(null);
    const found = validate(mode, email, password);
    setErrors(found);
    if (found.email) return emailRef.current?.focus();
    if (found.password) return passwordRef.current?.focus();

    setPending(true);
    try {
      const credentials = { email: email.trim(), password };
      if (mode === 'register') {
        await register(credentials);
        router.replace('/bienvenida');
      } else {
        await login(credentials);
        router.replace(next);
      }
    } catch (error) {
      setPending(false);
      if (error instanceof ApiError) {
        const fieldErrors = serverFieldErrors(mode, error.fields);
        setErrors(fieldErrors);
        setFormError(error.status === 429 ? 'Hiciste muchos intentos seguidos. Esperá un minuto y probá de nuevo.' : error.message);
      } else {
        setFormError('Algo salió mal. Probá de nuevo.');
      }
    }
  }

  // Al editar un campo su error deja de ser válido; se revalida al enviar.
  const clearError = (field: Field) => setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));

  const describedBy = (field: Field, extra?: string) =>
    [errors[field] ? `${id}-${field}-error` : null, extra].filter(Boolean).join(' ') || undefined;

  return (
    <div className="auth-card surface">
      <h1 className="auth-title">{text.title}</h1>
      <p className="auth-lead">{text.lead}</p>

      {formError && (
        <div ref={alertRef} tabIndex={-1} role="alert" className="form-alert">
          {formError}
        </div>
      )}

      <form noValidate onSubmit={onSubmit} aria-busy={pending} className="auth-form">
        <div className="field">
          <label htmlFor={`${id}-email`}>Email</label>
          <input
            ref={emailRef}
            id={`${id}-email`}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            required
            maxLength={254}
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              clearError('email');
            }}
            aria-invalid={Boolean(errors.email)}
            aria-describedby={describedBy('email')}
            disabled={pending}
          />
          {errors.email && <p id={`${id}-email-error`} className="field-error">{errors.email}</p>}
        </div>

        <div className="field">
          <label htmlFor={`${id}-password`}>Contraseña</label>
          {/* El botón va después del campo: orden de tabulación email → contraseña → mostrar → enviar. */}
          <div className="password-wrap">
            <input
              ref={passwordRef}
              id={`${id}-password`}
              name="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete={text.passwordAutocomplete}
              required
              minLength={mode === 'register' ? PASSWORD_MIN : undefined}
              maxLength={PASSWORD_MAX}
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                clearError('password');
              }}
              aria-invalid={Boolean(errors.password)}
              aria-describedby={describedBy('password', mode === 'register' ? `${id}-password-hint` : undefined)}
              disabled={pending}
            />
            <button
              type="button"
              className="link-button password-toggle"
              onClick={() => setShowPassword((value) => !value)}
              aria-controls={`${id}-password`}
              aria-pressed={showPassword}
            >
              {showPassword ? 'Ocultar' : 'Mostrar'}
            </button>
          </div>
          {mode === 'register' && (
            <p id={`${id}-password-hint`} className="field-hint">Mínimo {PASSWORD_MIN} caracteres. Una frase larga es más segura y fácil de recordar.</p>
          )}
          {errors.password && <p id={`${id}-password-error`} className="field-error">{errors.password}</p>}
        </div>

        <button type="submit" className="primary-button" disabled={pending}>
          {pending ? text.pending : text.submit}
        </button>
      </form>

      <p className="auth-switch">
        {text.switchText}{' '}
        <Link href={searchParams.get('next') ? `${text.switchHref}?next=${encodeURIComponent(next)}` : text.switchHref}>
          {text.switchLink}
        </Link>
      </p>
    </div>
  );
}

export function AuthFormFallback() {
  return <div className="auth-card surface" aria-busy="true"><p className="auth-lead">Cargando…</p></div>;
}
