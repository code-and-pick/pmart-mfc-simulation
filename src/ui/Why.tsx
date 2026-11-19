// "왜? ›" — 긴 설명은 눌렀을 때만(사용자 2026-11-20 "주절주절 … 구리게", 시안 mock2). 화면에는 할 일 한 줄만 둔다.
import { useState, type ReactNode } from 'react';

export function Why({ children, label = '왜?' }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`why ${open ? 'open' : ''}`}>
      <button className="why-b" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {label} {open ? '⌄' : '›'}
      </button>
      {open && <div className="why-t">{children}</div>}
    </div>
  );
}

/** 서버 값이 아니라 화면이 짐작한 값 — 회색 칩 하나 */
export function Guess({ title }: { title?: string }) {
  return (
    <span className="guess" title={title ?? '서버 값이 아니라 화면이 짐작한 값'}>
      추정
    </span>
  );
}
