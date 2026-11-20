interface HubLogoImageProps {
  className?: string;
}

export default function HubLogoImage({ className = '' }: HubLogoImageProps) {
  return (
    <picture className="inline-block">
      <source srcSet="/gokez_hub_logo-removebg.webp" type="image/webp" />
      <img src="/gokez_hub_logo-removebg.png" alt="Gokez Hub" className={className} />
    </picture>
  );
}
