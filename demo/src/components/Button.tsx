import type { ReactNode } from 'react';

interface ButtonProps {
  children: ReactNode;
  variant?: 'primary' | 'secondary';
  size?: 'default' | 'small';
  href?: string;
  onClick?: () => void;
  type?: 'button' | 'submit';
}

export function Button({ children, variant = 'primary', size = 'default', href, onClick, type = 'button' }: ButtonProps) {
  const className = `btn btn-${variant}${size === 'small' ? ' btn-small' : ''}`;
  if (href) {
    return (
      <a className={className} href={href}>
        {children}
      </a>
    );
  }
  return (
    <button className={className} type={type} onClick={onClick}>
      {children}
    </button>
  );
}
