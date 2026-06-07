// Calm LECTURE loading state — a standfirst and a quiet skeleton, no spinners.
export default function Loading() {
  return (
    <div className="wrap" style={{ maxWidth: 980, padding: "64px 24px 96px" }}>
      <p className="kicker">LORE · runtime</p>
      <p className="standfirst" style={{ marginTop: 12, maxWidth: "30ch" }}>
        Reading the runtime…
      </p>
      <p className="soft" style={{ marginTop: 8, maxWidth: "52ch" }}>
        Fetching live, tenant-scoped state from the backend.
      </p>

      <div className="col" aria-hidden="true" style={{ gap: 14, marginTop: 36 }}>
        <Bar w="70%" h={26} />
        <Bar w="100%" />
        <Bar w="94%" />
        <Bar w="62%" />
        <div className="row" style={{ gap: 14, marginTop: 10, flexWrap: "wrap" }}>
          <Bar w={180} h={92} />
          <Bar w={180} h={92} />
          <Bar w={180} h={92} />
        </div>
      </div>
    </div>
  );
}

function Bar({ w, h = 14 }: { w: number | string; h?: number }) {
  return (
    <span
      className="reveal"
      style={{
        width: typeof w === "number" ? `${w}px` : w,
        height: h,
        borderRadius: h > 40 ? 14 : 6,
        background: "var(--paper-2)",
        border: "1px solid var(--line)",
        display: "block",
      }}
    />
  );
}
