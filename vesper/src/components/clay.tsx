import {
  Check,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  Info,
  Loader2,
  SearchX,
  ShieldAlert,
  X,
  type LucideIcon,
} from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

/* ============================== ClayCard ================================== */

export function ClayCard({
  children,
  className = '',
  lift = false,
  sunken = false,
  accent = false,
  pad = true,
  ...rest
}: {
  children: ReactNode;
  className?: string;
  lift?: boolean;
  sunken?: boolean;
  accent?: boolean;
  pad?: boolean;
} & React.HTMLAttributes<HTMLDivElement>) {
  const cls = [
    sunken ? 'clay-card--sunken' : 'clay-card',
    lift ? 'clay-card--lift' : '',
    accent ? 'clay-card--accent' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={cls} style={pad ? undefined : { padding: 0 }} {...rest}>
      {children}
    </div>
  );
}

/* ============================== ClayButton ================================ */

type ButtonVariant = 'default' | 'primary' | 'danger' | 'ghost';

export function ClayButton({
  children,
  variant = 'default',
  size,
  icon: Icon,
  iconRight: IconRight,
  loading = false,
  className = '',
  ...rest
}: {
  children?: ReactNode;
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  icon?: LucideIcon;
  iconRight?: LucideIcon;
  loading?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const cls = ['btn', variant !== 'default' ? `btn--${variant}` : '', size === 'sm' ? 'btn--sm' : '', className]
    .filter(Boolean)
    .join(' ');
  return (
    <button type="button" className={cls} disabled={rest.disabled || loading} {...rest}>
      {loading ? <Loader2 className="spin" aria-hidden /> : Icon ? <Icon aria-hidden /> : null}
      {children}
      {IconRight && !loading ? <IconRight aria-hidden /> : null}
    </button>
  );
}

export function IconButton({
  label,
  icon: Icon,
  size,
  variant = 'ghost',
  ...rest
}: {
  label: string;
  icon: LucideIcon;
  size?: 'sm' | 'md';
  variant?: ButtonVariant;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={['btn', 'btn--icon', variant !== 'default' ? `btn--${variant}` : '', size === 'sm' ? 'btn--sm' : '']
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      <Icon aria-hidden />
    </button>
  );
}

/* ============================== ClayInput ================================= */

export function ClayInput({
  label,
  hint,
  icon: Icon,
  className = '',
  id,
  ...rest
}: {
  label?: string;
  hint?: string;
  icon?: LucideIcon;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  const auto = useId();
  const inputId = id ?? auto;
  return (
    <div className={`field ${className}`}>
      {label && (
        <label className="field__label" htmlFor={inputId}>
          {label}
        </label>
      )}
      <div style={{ position: 'relative' }}>
        {Icon && (
          <Icon
            aria-hidden
            style={{
              position: 'absolute',
              left: 12,
              top: '50%',
              transform: 'translateY(-50%)',
              width: 15,
              height: 15,
              color: 'var(--text-3)',
              pointerEvents: 'none',
            }}
          />
        )}
        <input id={inputId} className="input" style={Icon ? { paddingLeft: 34 } : undefined} {...rest} />
      </div>
      {hint && (
        <span className="tiny muted" id={`${inputId}-hint`}>
          {hint}
        </span>
      )}
    </div>
  );
}

export function ClaySelect<T extends string>({
  label,
  value,
  options,
  onChange,
  className = '',
  disabled,
  id,
}: {
  label?: string;
  value: T;
  options: readonly (T | { value: T; label: string })[];
  onChange: (v: T) => void;
  className?: string;
  disabled?: boolean;
  id?: string;
}) {
  const auto = useId();
  const selectId = id ?? auto;
  const [open, setOpen] = useState(false);
  const [focusIdx, setFocusIdx] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const normalized = options.map((o) => (typeof o === 'string' ? { value: o as T, label: o as string } : o));
  const current = normalized.find((o) => o.value === value);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Keep the highlighted option visible while arrowing.
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.children[focusIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [focusIdx, open]);

  const openList = () => {
    setFocusIdx(Math.max(0, normalized.findIndex((o) => o.value === value)));
    setOpen(true);
  };

  const commit = (v: T) => {
    onChange(v);
    setOpen(false);
  };

  const onButtonKey = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openList();
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setFocusIdx((i) => Math.min(normalized.length - 1, i + 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setFocusIdx((i) => Math.max(0, i - 1));
        break;
      case 'Home':
        e.preventDefault();
        setFocusIdx(0);
        break;
      case 'End':
        e.preventDefault();
        setFocusIdx(normalized.length - 1);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        commit(normalized[focusIdx].value);
        break;
      case 'Tab':
        setOpen(false);
        break;
    }
  };

  return (
    <div className={`field ${className}`} ref={rootRef}>
      {label && (
        <label className="field__label" htmlFor={selectId}>
          {label}
        </label>
      )}
      <div className="select-wrap">
        <button
          type="button"
          id={selectId}
          className="select select--button"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => (open ? setOpen(false) : openList())}
          onKeyDown={onButtonKey}
        >
          <span className="truncate">{current?.label ?? value}</span>
        </button>
        <ChevronDown aria-hidden />
        {open && (
          <div className="select-pop" role="listbox" aria-label={label ?? 'Options'} ref={listRef}>
            {normalized.map((o, i) => (
              <button
                type="button"
                role="option"
                aria-selected={o.value === value}
                key={o.value}
                className={`select-pop__opt${o.value === value ? ' is-active' : ''}${i === focusIdx ? ' is-focus' : ''}`}
                onMouseEnter={() => setFocusIdx(i)}
                onClick={() => commit(o.value)}
              >
                {o.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function ClayCheckbox({
  label,
  checked,
  onChange,
  disabled,
  title,
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <label className="check" title={title} style={disabled ? { opacity: 0.55, cursor: 'not-allowed' } : undefined}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="check__box">
        <Check strokeWidth={3.2} aria-hidden />
      </span>
      <span>{label}</span>
    </label>
  );
}

export function ClayToggle({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="toggle" style={disabled ? { opacity: 0.55, cursor: 'not-allowed' } : undefined}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle__track">
        <span className="toggle__thumb" />
      </span>
      <span>{label}</span>
    </label>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: readonly { value: T; label: string; icon?: LucideIcon }[];
  onChange: (v: T) => void;
  label?: string;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.icon ? <o.icon aria-hidden /> : null}
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ============================== StatusPill ================================ */

export function StatusPill({ value, kind }: { value: string; kind?: 'verified' | 'banned' | 'active' }) {
  const v = String(value);
  let cls = 'pill--no';
  let icon: LucideIcon | null = null;

  if (kind === 'banned') {
    cls = v === 'Yes' ? 'pill--bad' : 'pill--no';
    icon = v === 'Yes' ? ShieldAlert : null;
  } else if (kind === 'active') {
    cls = v === 'Yes' ? 'pill--yes' : v === 'No' ? 'pill--warn' : 'pill--no';
    icon = v === 'Yes' ? CircleCheck : v === 'No' ? CircleAlert : null;
  } else {
    cls = v === 'Yes' ? 'pill--yes' : v === 'No' ? 'pill--no' : 'pill--warn';
    icon = v === 'Yes' ? CircleCheck : null;
  }

  const Icon = icon;
  return (
    <span className={`pill ${cls}`}>
      {Icon ? <Icon aria-hidden /> : null}
      {v}
    </span>
  );
}

/* ============================== Skeletons ================================= */

export function Skeleton({ w, h, r, style }: { w?: number | string; h?: number | string; r?: number; style?: React.CSSProperties }) {
  return <div className="skel" style={{ width: w, height: h, borderRadius: r, ...style }} aria-hidden />;
}

export function SkeletonRows({ rows = 6, cols = 7 }: { rows?: number; cols?: number }) {
  return (
    <tbody>
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r} style={{ cursor: 'default' }}>
          {Array.from({ length: cols }, (_, c) => (
            <td key={c}>
              <Skeleton w={c === 0 ? 22 : c === 1 ? 120 : 54} h={11} />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  );
}

export function SkeletonCards({ count = 8 }: { count?: number }) {
  return (
    <div className="inv-grid">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="clay-card" style={{ padding: 0, overflow: 'hidden' }}>
          <Skeleton w="100%" h={150} r={0} />
          <div style={{ padding: 11, display: 'flex', flexDirection: 'column', gap: 7 }}>
            <Skeleton w="85%" h={11} />
            <Skeleton w="45%" h={11} />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ============================== EmptyState ================================ */

const EMPTY_ART = {
  search: SearchX,
  error: CircleAlert,
  info: Info,
} as const;

export function EmptyState({
  title,
  text,
  art = 'info',
  action,
}: {
  title: string;
  text?: string;
  art?: keyof typeof EMPTY_ART;
  action?: ReactNode;
}) {
  const Icon = EMPTY_ART[art];
  return (
    <div className="empty">
      <svg
        className="empty__art"
        width="86"
        height="86"
        viewBox="0 0 86 86"
        fill="none"
        aria-hidden
        style={{ color: 'var(--surface-3)' }}
      >
        <rect x="7" y="15" width="72" height="52" rx="12" stroke="currentColor" strokeWidth="2.5" />
        <rect x="17" y="27" width="24" height="5" rx="2.5" fill="currentColor" opacity="0.5" />
        <rect x="17" y="38" width="38" height="5" rx="2.5" fill="currentColor" opacity="0.32" />
        <rect x="17" y="49" width="30" height="5" rx="2.5" fill="currentColor" opacity="0.2" />
        <circle cx="62" cy="52" r="12" stroke="currentColor" strokeWidth="2.5" opacity="0.75" />
        <path d="M71 61l8 8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity="0.75" />
      </svg>
      <div className="row" style={{ gap: 8, alignItems: 'center' }}>
        <Icon style={{ width: 15, height: 15, color: 'var(--text-3)' }} aria-hidden />
        <div className="empty__title">{title}</div>
      </div>
      {text && <p className="empty__text">{text}</p>}
      {action}
    </div>
  );
}

/* ================================ Modal =================================== */

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide = false,
  icon: Icon,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  icon?: LucideIcon;
}) {
  useEscape(open, onClose);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) ref.current?.focus();
  }, [open]);

  if (!open) return null;
  return (
    <div className="overlay overlay--center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className={`modal ${wide ? 'modal--wide' : ''}`}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        ref={ref}
      >
        <div className="modal__head">
          {Icon && <Icon style={{ width: 18, height: 18, color: 'var(--accent-soft)', flex: 'none' }} aria-hidden />}
          <div className="modal__title">{title}</div>
          <IconButton label="Close" icon={X} onClick={onClose} />
        </div>
        <div className="modal__body">{children}</div>
        {footer && <div className="modal__foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  actions,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  actions?: ReactNode;
}) {
  useEscape(open, onClose);
  if (!open) return null;
  return (
    <div className="overlay overlay--right" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : 'Details'}>
        <div className="modal__head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="modal__title truncate">{title}</div>
            {subtitle && <div className="tiny muted truncate">{subtitle}</div>}
          </div>
          {actions}
          <IconButton label="Close" icon={X} onClick={onClose} />
        </div>
        <div className="modal__body">{children}</div>
        {footer && <div className="modal__foot">{footer}</div>}
      </aside>
    </div>
  );
}

function useEscape(active: boolean, fn: () => void): void {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') fn();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, fn]);
}

/* ================================ Toasts ================================== */

export interface Toast {
  id: number;
  message: string;
  tone: 'ok' | 'bad' | 'info';
}

interface ToastCtx {
  toast: (message: string, tone?: Toast['tone']) => void;
}
const ToastContext = createContext<ToastCtx>({ toast: () => {} });
export const useToast = () => useContext(ToastContext);

const TONE_ICON = { ok: CircleCheck, bad: CircleAlert, info: Info } as const;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const toast = useCallback((message: string, tone: Toast['tone'] = 'info') => {
    const id = ++seq.current;
    setToasts((t) => [...t.slice(-3), { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-host" role="status" aria-live="polite">
        {toasts.map((t) => {
          const Icon = TONE_ICON[t.tone];
          return (
            <div key={t.id} className={`toast toast--${t.tone}`}>
              <Icon aria-hidden />
              <span>{t.message}</span>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

/* =============================== CountUp ================================== */

/** Animated number that respects reduced motion. */
export function CountUp({ value, duration = 650 }: { value: number | null; duration?: number }) {
  const [display, setDisplay] = useState(value ?? 0);
  const from = useRef(value ?? 0);
  const reduced = prefersReducedMotion();

  useEffect(() => {
    if (value === null) return;
    if (reduced) {
      setDisplay(value);
      from.current = value;
      return;
    }
    const start = performance.now();
    const a = from.current;
    const b = value;
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(a + (b - a) * eased));
      if (t < 1) raf = requestAnimationFrame(step);
      else from.current = b;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, duration, reduced]);

  if (value === null) return <span className="muted">Unavailable</span>;
  return <>{display.toLocaleString('en-US')}</>;
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
