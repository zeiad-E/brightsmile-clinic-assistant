import ChatWidget from "@/components/ChatWidget";

export default function HomePage() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">BrightSmile Dental Clinic</h1>
      <p className="mt-2 text-zinc-600">
        Your smile, our priority. Ask us anything or book an appointment — anytime.
      </p>

      {/* TODO: services, hours, location sections (bilingual EN/AR). */}

      <ChatWidget />
    </main>
  );
}
