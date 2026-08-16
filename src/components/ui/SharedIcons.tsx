type IconProps = {
  className?: string;
  size?: number;
};

type HeartIconProps = IconProps & {
  filled?: boolean;
};

type BookmarkIconProps = IconProps & {
  strokeWidth?: number;
  variant?: "default" | "chrome";
};

// Icones extraidos dos componentes existentes para evitar duplicacao de SVG.
export function HeartIcon({ className, filled = false, size = 18 }: HeartIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.16667"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M11.0833 8.16667C11.9525 7.315 12.8333 6.29417 12.8333 4.95833C12.8333 4.10743 12.4953 3.29138 11.8936 2.6897C11.292 2.08802 10.4759 1.75 9.625 1.75C8.59833 1.75 7.875 2.04167 7 2.91667C6.125 2.04167 5.40167 1.75 4.375 1.75C3.5241 1.75 2.70804 2.08802 2.10637 2.6897C1.50469 3.29138 1.16667 4.10743 1.16667 4.95833C1.16667 6.3 2.04167 7.32083 2.91667 8.16667L7 12.25L11.0833 8.16667Z" />
    </svg>
  );
}

export function CheckIcon({ className, size = 18 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.16667"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M12.25 3.5L5.25 10.5L1.75 7" />
    </svg>
  );
}

export function TrashIcon({ className, size = 18 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.16667"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M1.75 3.5H12.25" />
      <path d="M11.0833 3.5V11.6667C11.0833 12.25 10.5 12.8333 9.91667 12.8333H4.08333C3.5 12.8333 2.91667 12.25 2.91667 11.6667V3.5" />
      <path d="M4.66667 3.5V2.33334C4.66667 1.75 5.25 1.16667 5.83333 1.16667H8.16667C8.75 1.16667 9.33333 1.75 9.33333 2.33334V3.5" />
      <path d="M5.83333 6.41667V9.91667" />
      <path d="M8.16667 6.41667V9.91667" />
    </svg>
  );
}

export function BookmarkIcon({ className, size = 18, strokeWidth = 2, variant = "default" }: BookmarkIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path
        d={
          variant === "chrome"
            ? "m19 21-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2Z"
            : "M6 4.5h12A0.5 0.5 0 0 1 18.5 5v15.5L12 16l-6.5 4.5V5A0.5 0.5 0 0 1 6 4.5z"
        }
      />
    </svg>
  );
}

export function ChevronRightIcon({ className, size = 18 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

export function SearchIcon({ className, size = 16 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}

export function ClearIcon({ className, size = 16 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className={className}
      aria-hidden="true"
    >
      <path d="m6 6 12 12" />
      <path d="m18 6-12 12" />
    </svg>
  );
}
