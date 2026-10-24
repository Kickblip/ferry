import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog"
import { CreateNewProductForm } from "./create-new-product-form"
import { Button } from "@/components/ui/button"
import { Plus } from "lucide-react"

export default function Page() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" />
          <div className="font-medium">Create Product</div>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <CreateNewProductForm />
      </DialogContent>
    </Dialog>
  )
}
