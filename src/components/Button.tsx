import type { ButtonHTMLAttributes, ReactNode } from "react";
import {
  buttonClassName,
  type ButtonSize,
  type ButtonVariant,
} from "./buttonStyles";

export function Button({
  variant = "default",
  size = "md",
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
}) {
  return (
    <button {...props} className={buttonClassName({ variant, size, className })}>
      {children}
    </button>
  );
}
