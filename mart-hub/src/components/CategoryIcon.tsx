interface CategoryIconProps {
  icon: string;
  name: string;
  className?: string;
}

export default function CategoryIcon({ icon, name, className = 'w-5 h-5 object-contain' }: CategoryIconProps) {
  const isUrl = icon?.startsWith('/') || icon?.startsWith('http');
  if (isUrl) return <img src={icon} alt={name} className={className} />;
  return <span>{icon}</span>;
}
