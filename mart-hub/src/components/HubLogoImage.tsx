interface HubLogoImageProps {
  className?: string;
}

export default function HubLogoImage({ className = '' }: HubLogoImageProps) {
  return (
    <picture className="inline-block leading-none align-bottom">
      <source srcSet="/gokez_hub_logo_removebg.webp" type="image/webp" />
      <img src="/gokez_hub_logo_removebg.png" alt="Gokez Hub" className={className} />
    </picture>
  );
}
