'use client';

import { AlertTriangle, Loader2, X } from 'lucide-react';

interface ConfirmationModalProps {
  open: boolean;
  title: string;
  description: string;
  detail?: string;
  confirmLabel?: string;
  isPending?: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
}

export function ConfirmationModal({
  open,
  title,
  description,
  detail,
  confirmLabel = 'Confirmar exclusão',
  isPending = false,
  onClose,
  onConfirm,
}: ConfirmationModalProps) {
  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={() => !isPending && onClose()}>
      <div className="modal-content" onClick={event => event.stopPropagation()} style={{ maxWidth: 500 }}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem' }}>
            <span style={{ display: 'grid', placeItems: 'center', width: 36, height: 36, borderRadius: 10, color: '#b42318', background: '#fef3f2' }}>
              <AlertTriangle size={19} />
            </span>
            <h3>{title}</h3>
          </div>
          <button className="btn-icon" onClick={onClose} disabled={isPending} aria-label="Fechar"><X size={18} /></button>
        </div>
        <div className="modal-body">
          <p style={{ lineHeight: 1.55 }}>{description}</p>
          {detail && <div style={{ marginTop: '.875rem', padding: '.75rem', borderRadius: 'var(--radius-md)', background: 'var(--surface-muted, #f7f8fb)', color: 'var(--text-muted)', fontSize: '.8125rem', lineHeight: 1.5 }}>{detail}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose} disabled={isPending}>Cancelar</button>
          <button className="btn btn-danger" onClick={onConfirm} disabled={isPending}>
            {isPending && <Loader2 size={15} className="spinner" />}
            {isPending ? 'Processando...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
