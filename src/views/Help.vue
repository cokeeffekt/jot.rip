<script setup lang="ts"></script>

<template>
  <section class="flex h-full min-h-0 flex-col gap-6 overflow-hidden">
    <header class="shrink-0">
      <p class="text-xs uppercase tracking-[0.2em] text-slate-400">Help</p>
      <h1 class="text-2xl font-semibold text-white">Quick reference</h1>
    </header>

    <div class="min-h-0 flex-1 space-y-4 overflow-auto px-2 pr-1 sm:px-0">
      <section class="border border-white/10 bg-white/5 p-3 sm:p-4">
        <h2 class="text-sm font-semibold text-white">Jots & tabs</h2>
        <ul class="mt-2 space-y-1 text-sm text-slate-200">
          <li>Each jot has one or more tabs. Tab bar scrolls horizontally; add with “+”, rename, move, or delete (last tab cannot be deleted).</li>
          <li>Pin a jot to keep it at the top. Archive hides it from Calendar; archived items sit at the bottom list.</li>
          <li>Note color tints the editor, tab, and list accents.</li>
          <li>Autosave runs as you type and when you navigate away. Title changes also save on blur/navigation.</li>
          <li>Read-only: if the same jot is open in another browser tab, newcomers open in read-only to avoid clashes.</li>
        </ul>
      </section>

      <section class="border border-white/10 bg-white/5 p-3 sm:p-4">
        <h2 class="text-sm font-semibold text-white">Editor basics</h2>
        <ul class="mt-2 space-y-1 text-sm text-slate-200">
          <li>Plain textarea with fixed line height; gutter shows icons for checkboxes, links, tags, dates, and images.</li>
          <li>Checklists: use <span class="font-mono text-slate-100">- [ ]</span> or <span class="font-mono text-slate-100">- [x]</span>. Click the gutter checkbox to toggle.</li>
          <li>Line wrapping is supported; gutter alignment adapts to wraps.</li>
        </ul>
      </section>

      <section class="border border-white/10 bg-white/5 p-3 sm:p-4">
        <h2 class="text-sm font-semibold text-white">Tags</h2>
        <ul class="mt-2 space-y-1 text-sm text-slate-200">
          <li>Start a line with <span class="font-mono text-slate-100">#</span>; the rest of the line is the tag.</li>
          <li><span class="font-mono text-slate-100">#</span> lines get a green highlight and gutter icon.</li>
          <li><span class="font-mono text-slate-100">#!</span> makes a priority tag: orange highlight, bold, orange gutter icon, and sorted first.</li>
          <li>Tags show in the Jots list, Home tag cloud, and are searchable (title + tags).</li>
        </ul>
      </section>

      <section class="border border-white/10 bg-white/5 p-3 sm:p-4">
        <h2 class="text-sm font-semibold text-white">Dates & calendar</h2>
        <p class="mt-2 text-sm text-slate-300">
          Type a date token like <span class="font-mono text-slate-100">@today</span> and press space to normalize it
          into <span class="font-mono text-slate-100">@YYYY-MM-DD</span>. Everything after the token on that line becomes the calendar entry.
        </p>
        <p class="mt-2 text-sm text-slate-300">
          You can also add optional calendar rules directly after the date token using brackets.
          Both shorthand and named forms are supported:
          <span class="font-mono text-slate-100">@2025-12-22[s2d,r1y]</span> or
          <span class="font-mono text-slate-100">@2025-12-22[span=2d,repeat=1y]</span>.
        </p>
        <div class="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <p class="text-xs uppercase tracking-[0.2em] text-slate-400">Basics</p>
            <ul class="mt-2 space-y-1 text-sm text-slate-200">
              <li><span class="font-mono">@today</span></li>
              <li><span class="font-mono">@tomorrow</span></li>
              <li><span class="font-mono">@yesterday</span></li>
              <li><span class="font-mono">@inaweek</span></li>
            </ul>
          </div>
          <div>
            <p class="text-xs uppercase tracking-[0.2em] text-slate-400">Relative</p>
            <ul class="mt-2 space-y-1 text-sm text-slate-200">
              <li><span class="font-mono">@in2days</span>, <span class="font-mono">@in10days</span></li>
              <li><span class="font-mono">@in2weeks</span>, <span class="font-mono">@in3months</span></li>
              <li><span class="font-mono">@in1year</span></li>
            </ul>
          </div>
          <div>
            <p class="text-xs uppercase tracking-[0.2em] text-slate-400">Week / Month / Year</p>
            <ul class="mt-2 space-y-1 text-sm text-slate-200">
              <li><span class="font-mono">@thisweek</span> (Monday)</li>
              <li><span class="font-mono">@nextweek</span> (next Monday)</li>
              <li><span class="font-mono">@nextmonth</span></li>
              <li><span class="font-mono">@nextyear</span></li>
              <li><span class="font-mono">@eow</span>, <span class="font-mono">@eom</span>, <span class="font-mono">@eoy</span></li>
            </ul>
          </div>
          <div>
            <p class="text-xs uppercase tracking-[0.2em] text-slate-400">Weekdays</p>
            <ul class="mt-2 space-y-1 text-sm text-slate-200">
              <li><span class="font-mono">@monday</span> … <span class="font-mono">@sunday</span></li>
              <li><span class="font-mono">@mon</span>, <span class="font-mono">@tue</span>, <span class="font-mono">@wed</span>, <span class="font-mono">@thu</span>, <span class="font-mono">@fri</span></li>
              <li><span class="font-mono">@sat</span>, <span class="font-mono">@sun</span></li>
              <li><span class="font-mono">@nextmonday</span> (always future)</li>
            </ul>
          </div>
          <div class="sm:col-span-2">
            <p class="text-xs uppercase tracking-[0.2em] text-slate-400">Business</p>
            <ul class="mt-2 space-y-1 text-sm text-slate-200">
              <li><span class="font-mono">@weekday</span> (today if Mon–Fri, else next Monday)</li>
              <li><span class="font-mono">@nextweekday</span> (next Mon–Fri day)</li>
            </ul>
          </div>
          <div class="sm:col-span-2">
            <p class="text-xs uppercase tracking-[0.2em] text-slate-400">Calendar Rules</p>
            <ul class="mt-2 space-y-1 text-sm text-slate-200">
              <li>
                Span: <span class="font-mono">s2d</span> or <span class="font-mono">span=2d</span> (units:
                <span class="font-mono">d</span>, <span class="font-mono">w</span>, <span class="font-mono">m</span>,
                <span class="font-mono">y</span>)
              </li>
              <li>
                Repeat: <span class="font-mono">r2w</span> or <span class="font-mono">repeat=2w</span> (units:
                <span class="font-mono">d</span>, <span class="font-mono">w</span>, <span class="font-mono">m</span>,
                <span class="font-mono">y</span>)
              </li>
              <li>
                Examples:
                <span class="font-mono">@2025-12-22[r1y]</span>,
                <span class="font-mono">@2022-12-22[s2d]</span>,
                <span class="font-mono">@2022-12-22[s1w,r2w]</span>
              </li>
            </ul>
          </div>
        </div>
      </section>

      <section class="border border-white/10 bg-white/5 p-3 sm:p-4">
        <h2 class="text-sm font-semibold text-white">Images</h2>
        <ul class="mt-2 space-y-1 text-sm text-slate-200">
          <li>Add images via “Add Image” button or paste. They are stored locally (and synced if enabled).</li>
          <li>Editor inserts a placeholder line like <span class="font-mono text-slate-100">![image:abc123]</span>.</li>
          <li>Gutter shows a thumbnail; tap to open the full image viewer. Deleting the placeholder keeps the image for safety until cleanup.</li>
          <li>Exports embed images directly in the HTML; re-import recreates them.</li>
        </ul>
      </section>

      <section class="border border-white/10 bg-white/5 p-3 sm:p-4">
        <h2 class="text-sm font-semibold text-white">Export & import</h2>
        <ul class="mt-2 space-y-1 text-sm text-slate-200">
          <li>Export a jot to single-file HTML (includes tabs, text, images, and an import button inside) or to plain text.</li>
          <li>“Import” page accepts exported HTML and recreates the jot (new id).</li>
          <li>Settings has “Export all” and “Clear all data” (with double confirm).</li>
        </ul>
      </section>

      <section class="border border-white/10 bg-white/5 p-3 sm:p-4">
        <h2 class="text-sm font-semibold text-white">Sync</h2>
        <ul class="mt-2 space-y-1 text-sm text-slate-200">
          <li>Enter your <span class="font-mono text-slate-100">user/pass/phrase</span> bundle and server URL in Settings (server defaults to current origin).</li>
          <li>Data is encrypted client-side with your passphrase; server stores encrypted blobs per user. Auth is Basic (user/password) auto-provisioned on first request.</li>
          <li>Triggers: on load, interval (if enabled), when app regains focus, when opening the jot list, on tab/note change, and via the menu “Sync now” (visible when sync is on).</li>
          <li>Deletes propagate via tombstones (notes, tabs, images).</li>
          <li>Multiple browser tabs: the first to open a jot is editable; others open read-only and will refresh when changes arrive.</li>
          <li>To change your user/pass/phrase, export a backup, wipe local + remote data, create a new bundle, then import the backup.</li>
        </ul>
      </section>
    </div>
  </section>
</template>
