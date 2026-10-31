import { useCallback, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { cn } from '@/lib/cn'

interface DropzoneProps {
  onFiles: (files: File[]) => void
  disabled?: boolean
  compact?: boolean
}

export function Dropzone({ onFiles, disabled, compact }: DropzoneProps) {
  const [over, setOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const pick = useCallback(
    (list: FileList | null) => {
      if (!list) return
      const files = [...list].filter((f) => f.type.startsWith('image/'))
      if (files.length) onFiles(files)
    },
    [onFiles],
  )

  return (
    <motion.button
      type="button"
      disabled={disabled}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault()
        if (!disabled) setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        if (!disabled) pick(e.dataTransfer.files)
      }}
      whileHover={disabled ? undefined : { scale: 1.005 }}
      whileTap={disabled ? undefined : { scale: 0.995 }}
      className={cn(
        'group flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed text-center transition-colors',
        compact ? 'px-6 py-6' : 'px-8 py-16',
        disabled && 'cursor-not-allowed opacity-50',
        over ? 'border-accent bg-accent/5' : 'border-zinc-700 hover:border-zinc-500',
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => pick(e.target.files)}
      />
      <p className={cn('font-medium text-zinc-100', compact ? 'text-sm' : 'text-lg')}>
        {compact ? 'Add more photos' : 'Drop photos here, or click to browse'}
      </p>
      {!compact && (
        <p className="font-mono text-xs text-zinc-500">
          Add many at once — indexed on your device, never uploaded
        </p>
      )}
    </motion.button>
  )
}
