import Image from "next/image";

export function BrandLogo({ small = false }: { small?: boolean }) {
  const size = small ? 32 : 40;

  return <Image className="brandLogo" src="/code-forge.png" alt="" aria-hidden="true" width={size} height={size} unoptimized />;
}
