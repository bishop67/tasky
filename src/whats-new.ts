import { ItemView, MarkdownRenderer, WorkspaceLeaf, setIcon } from "obsidian";
import type Tasky from "./main";
import n100 from "../docs/releases/1.0.0.md";
import n110 from "../docs/releases/1.1.0.md";
import n120 from "../docs/releases/1.2.0.md";
import n121 from "../docs/releases/1.2.1.md";
import n130 from "../docs/releases/1.3.0.md";
import n131 from "../docs/releases/1.3.1.md";
import n140 from "../docs/releases/1.4.0.md";
import n150 from "../docs/releases/1.5.0.md";
import n151 from "../docs/releases/1.5.1.md";

export const WHATS_NEW_VIEW = "tasky-whats-new";

const RELEASES_URL = "https://github.com/bishop67/tasky/releases";

// Newest first. Each release adds its docs/releases/<version>.md here.
const NOTES: [version: string, markdown: string][] = [
  ["1.5.1", n151],
  ["1.5.0", n150],
  ["1.4.0", n140],
  ["1.3.1", n131],
  ["1.3.0", n130],
  ["1.2.1", n121],
  ["1.2.0", n120],
  ["1.1.0", n110],
  ["1.0.0", n100],
];

// Opens in a tab after an update, like TaskNotes: the installed version expanded, older ones folded.
export class WhatsNewView extends ItemView {
  constructor(leaf: WorkspaceLeaf, private plugin: Tasky) {
    super(leaf);
  }

  getViewType() {
    return WHATS_NEW_VIEW;
  }

  getDisplayText() {
    return "What's new";
  }

  getIcon() {
    return "sparkles";
  }

  async onOpen() {
    const el = this.contentEl;
    el.empty();
    el.addClass("tasky-whats-new");
    const current = this.plugin.manifest.version;
    el.createEl("h1", { text: `What's new in Tasky ${current}` });

    for (const [version, markdown] of NOTES) {
      const isCurrent = version === current;
      const section = el.createEl("details", { cls: "tasky-whats-new__version" });
      section.open = isCurrent || version === NOTES[0][0];
      const summary = section.createEl("summary");
      setIcon(summary.createSpan({ cls: "tasky-whats-new__chevron" }), "chevron-right");
      summary.createSpan({ cls: "tasky-whats-new__number", text: version });
      if (isCurrent) summary.createSpan({ cls: "tasky-whats-new__badge", text: "Installed" });
      await MarkdownRenderer.render(this.app, markdown, section.createDiv({ cls: "tasky-whats-new__body" }), "", this);
    }

    el.createEl("a", { cls: "tasky-whats-new__all", text: "All releases on GitHub", href: RELEASES_URL });
  }
}
