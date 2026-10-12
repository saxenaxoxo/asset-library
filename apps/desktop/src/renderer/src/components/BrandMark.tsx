import { useState } from 'react'
import { brand } from '@brand/brand-config'

interface BrandMarkProps {
  size: number
  className?: string
}

/** The product mark. Falls back to the monogram on an accent tile if the image can't load. */
export function BrandMark({ size, className }: BrandMarkProps): React.JSX.Element {
  const [failed, setFailed] = useState(false)

  if (failed) {
    return (
      <span
        role="img"
        aria-label={brand.productName}
        className={`inline-flex items-center justify-center rounded-[22%] bg-brand-600 font-semibold text-on-brand ${className ?? ''}`}
        style={{ width: size, height: size, fontSize: size * 0.38 }}
      >
        {brand.monogram}
      </span>
    )
  }

  return (
    <img
      src={brand.assets.logoMark}
      alt={brand.productName}
      width={size}
      height={size}
      draggable={false}
      className={className}
      onError={() => setFailed(true)}
    />
  )
}
