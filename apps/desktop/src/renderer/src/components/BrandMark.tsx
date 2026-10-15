import { useState } from 'react'
import { brand } from '@brand/brand-config'

interface BrandMarkProps {
  size: number
  className?: string
  /** 'product' is Asset Library's mark; 'hub' is the Goated Panels mark the hub window wears. */
  variant?: 'product' | 'hub'
}

/** A brand mark. Falls back to the monogram on an accent tile if the image can't load. */
export function BrandMark({
  size,
  className,
  variant = 'product'
}: BrandMarkProps): React.JSX.Element {
  const [failed, setFailed] = useState(false)
  const hub = variant === 'hub'
  const label = hub ? brand.brandName : brand.productName

  if (failed) {
    return (
      <span
        role="img"
        aria-label={label}
        className={`inline-flex items-center justify-center rounded-[22%] bg-brand-600 font-semibold text-on-brand ${className ?? ''}`}
        style={{ width: size, height: size, fontSize: size * 0.38 }}
      >
        {hub ? brand.hubMonogram : brand.monogram}
      </span>
    )
  }

  return (
    <img
      src={hub ? brand.assets.hubMark : brand.assets.logoMark}
      alt={label}
      width={size}
      height={size}
      draggable={false}
      className={className}
      onError={() => setFailed(true)}
    />
  )
}
