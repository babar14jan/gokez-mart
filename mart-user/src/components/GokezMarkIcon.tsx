interface GokezMarkIconProps {
  className?: string;
}

export default function GokezMarkIcon({ className = '' }: GokezMarkIconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 127 128"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M51,5 L39,17 L37,23 L37,31 L26,34 L21,41 L11,104 L11,114 L13,118 L20,123 L108,123 L116,115 L116,105 L106,41 L101,34 L90,31 L89,19 L80,7 L67,2 L61,2ZM60,42 L72,43 L80,47 L88,56 L88,60 L83,64 L71,55 L60,54 L52,58 L46,65 L44,72 L45,79 L61,97 L65,97 L80,80 L57,79 L54,75 L56,69 L90,68 L95,75 L94,80 L86,93 L66,112 L59,111 L39,91 L32,77 L32,69 L37,57 L47,47ZM46,24 L48,19 L54,13 L66,10 L72,12 L79,19 L81,24 L81,31 L47,32Z"
      />
      <path
        fill="#fff"
        d="M58,44 L48,48 L38,58 L34,67 L34,78 L36,84 L40,90 L60,110 L65,111 L73,105 L88,88 L92,81 L93,73 L90,70 L57,70 L56,71 L56,76 L59,78 L81,78 L82,79 L81,82 L65,99 L61,99 L46,84 L43,78 L43,69 L45,64 L52,56 L63,52 L70,53 L74,55 L82,62 L84,62 L87,58 L86,55 L79,48 L73,45Z"
      />
    </svg>
  );
}
