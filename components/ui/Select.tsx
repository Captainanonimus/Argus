import type { SelectHTMLAttributes } from "react";
import { inputClass } from "./Input";

export const selectClass = `${inputClass} cursor-pointer pr-7`;

export function Select({ className = "", ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`${selectClass} ${className}`} {...rest} />;
}
