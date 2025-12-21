<script setup lang="ts">
const githubUrl = 'https://github.com/cokeeffekt/jot.rip'
</script>

<template>
  <section class="flex h-full min-h-0 flex-col gap-4 overflow-hidden">
    <header class="shrink-0 px-2 sm:px-0">
      <p class="text-xs uppercase tracking-[0.2em] text-slate-400">About</p>
      <h1 class="text-2xl font-semibold text-white">jot.rip</h1>
    </header>

    <div class="min-h-0 flex-1 overflow-auto px-2 sm:px-0">
      <div class="space-y-4 border border-white/10 bg-slate-900/40 p-4 text-sm text-slate-200 sm:p-5 leading-relaxed">
        <p>I spent nearly twenty years trying to like note-taking apps.</p>

        <p>
          I tried the clever ones, the beautiful ones, the ones with backlinks and graphs and promises of a better brain.
          I tried systems, workflows, methods with names. Every time, I bounced off. Too much structure, too much
          ceremony, too much friction between thought and text.
        </p>

        <p>
          I always came back to plain text files. A folder. A cursor. Words on disk. It wasn’t elegant, but it stayed out
          of my way.
        </p>

        <p>
          Still, I kept looking for something better — something just as simple, but a little more intentional. Something
          that didn’t demand an account, a cloud, or a philosophy. Something that assumed my thoughts were already
          complicated enough.
        </p>

        <p>jot.rip is what that search quietly turned into.</p>

        <p>
          It’s offline-first, fast, and plain-text friendly. A single textarea editor. A predictable gutter. Optional
          sync, only if you want it. No accounts. No onboarding. No insistence that you do things the right way.
        </p>

        <p>
          In the end, I never actually built my dream notes app. But after about twelve hours of back-and-forth, Codex
          did — and it turns out, that’s good enough.
        </p>

        <p>And it’s open source.</p>

        <p>So if this is almost what you want, but not quite it, you too can go ask Codex to build what you want.</p>

        <p>If you have an opinion or a feature request, fork it. If you find a bug, send a PR.</p>
        <a
          :href="githubUrl"
          class="inline-flex items-center gap-2 border border-indigo-300/40 bg-indigo-500/20 px-3 py-2 text-sm font-semibold text-white hover:border-indigo-200/60"
          target="_blank"
          rel="noreferrer"
        >
          View on GitHub
          <span aria-hidden="true">↗</span>
        </a>
      </div>
    </div>
  </section>
</template>
