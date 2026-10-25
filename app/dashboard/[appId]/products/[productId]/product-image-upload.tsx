"use client"

import { useRef, useState, type ChangeEvent } from "react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { generateReactHelpers } from "@uploadthing/react"
import { ImageIcon, Pencil } from "lucide-react"
import { toast } from "sonner"
import type { OurFileRouter } from "@/app/api/uploadthing/core"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"

const { useUploadThing } = generateReactHelpers<OurFileRouter>()

export function ProductImageUpload({
  appId,
  productId,
  imageUrl,
  disabled,
}: {
  appId: string
  productId: string
  imageUrl: string | null
  disabled: boolean
}) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null)
  const currentImage = uploadedUrl ?? imageUrl
  const { startUpload, isUploading } = useUploadThing("productImage", {
    onClientUploadComplete(files) {
      const savedImage = files[0]?.serverData.imageUrl
      if (!savedImage) {
        toast.error(
          "The image uploaded but could not be saved. Please try again."
        )
        return
      }
      setUploadedUrl(savedImage)
      toast.success("Product image saved")
      router.refresh()
    },
    onUploadError(error) {
      toast.error(error.message)
    },
  })

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ""
    if (!file || isUploading || disabled) return
    if (!file.type.startsWith("image/") || file.size > 4 * 1024 * 1024) {
      toast.error("Choose an image smaller than 4 MB.")
      return
    }
    try {
      await startUpload([file], { appId, productId })
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to upload image"
      )
    }
  }

  return (
    <div
      className="relative grid aspect-square w-64 max-w-full place-items-center overflow-hidden rounded-md border bg-secondary"
      aria-busy={isUploading}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        hidden
        disabled={disabled || isUploading}
        onChange={upload}
      />
      {currentImage ? (
        <>
          <Image
            src={currentImage}
            alt="Product image"
            fill
            sizes="256px"
            className="object-cover"
          />
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            className="absolute top-2 right-2 z-10"
            aria-label="Replace product image"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled || isUploading}
          >
            <Pencil aria-hidden="true" />
          </Button>
        </>
      ) : (
        <Button
          type="button"
          variant="ghost"
          className="absolute inset-0 h-full w-full text-muted-foreground focus-visible:ring-inset"
          aria-label="Upload product image"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || isUploading}
        >
          <ImageIcon aria-hidden="true" className="size-8" />
        </Button>
      )}
      {isUploading && (
        <div
          role="status"
          className="pointer-events-none absolute inset-0 z-20 grid place-items-center bg-background/60"
        >
          <Spinner />
          <span className="sr-only">Uploading image…</span>
        </div>
      )}
    </div>
  )
}
