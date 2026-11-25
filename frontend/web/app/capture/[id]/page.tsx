import { PhoneCapture } from "@/components/capture/PhoneCapture";

export const dynamic = "force-dynamic";

/** The phone's page of the QR capture (no sign-in: the code's secret, in the link's #fragment, is the permission). */
export default async function CapturePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PhoneCapture id={id} />;
}
