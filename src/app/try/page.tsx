import { permanentRedirect } from "next/navigation";

/** The playground grew into the upload page; keep old links working. */
export default function TryPage() {
  permanentRedirect("/upload");
}
