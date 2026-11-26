import { App, PluginSettingTab, Setting, type SettingDefinitionItem } from "obsidian";
import type ObsidiFormatPlugin from "./main";

export class ObsidiFormatSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: ObsidiFormatPlugin) {
    super(app, plugin);
  }

  /** Declarative settings for Obsidian 1.13 and later. Older versions use display(). */
  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        name: "Local formatting",
        desc: "Formatting runs locally. Nothing is uploaded. Workspace options such as fonts, wrapping, and XML auto-decode are in the Payload Formatter view settings.",
      },
      {
        name: "Indentation size",
        desc: "Spaces inserted when beautifying. The view can also use 8 spaces or a tab.",
        render: (setting: Setting) => {
          setting.addDropdown((dropdown) => {
            dropdown.addOption("2", "2 spaces").addOption("4", "4 spaces").addOption("8", "8 spaces");
            dropdown.setValue(String(this.plugin.settings.indentSize));
            dropdown.onChange(async (value) => {
              if (value === "2" || value === "4" || value === "8") {
                this.plugin.settings.indentSize = Number(value) as 2 | 4 | 8;
                await this.plugin.saveSettings();
              }
            });
          });
        },
      },
      {
        name: "Indentation type",
        desc: "Tabs ignore the size above and indent with a single tab character.",
        control: {
          type: "dropdown",
          key: "indentType",
          options: { spaces: "Spaces", tabs: "Tabs" },
        },
      },
      {
        name: "Automatic format detection",
        desc: "Detect JSON, XML, or SOAP from the input. Turn this off to always use the default formatter.",
        control: { type: "toggle", key: "autoDetect" },
      },
      {
        name: "Default formatter",
        desc: "Used when automatic detection is off, and as the starting point for Auto Format Selection.",
        control: {
          type: "dropdown",
          key: "defaultFormatter",
          options: { json: "JSON", xml: "XML", soap: "SOAP" },
        },
      },
      {
        name: "Output preference",
        desc: "Keep formatted text in the output panel, or also copy it to the clipboard. Editor commands replace only the selection.",
        control: {
          type: "dropdown",
          key: "outputPreference",
          options: {
            panel: "Show in the output panel",
            "panel-and-clipboard": "Show in the panel and copy",
          },
        },
      },
      {
        name: "Syntax highlighting",
        desc: "Color JSON, XML, and SOAP in the Payload Formatter editors. Turn this off for very large payloads.",
        control: { type: "toggle", key: "syntaxHighlighting" },
      },
    ];
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("p", {
      text: "Formatting runs locally. Nothing is uploaded. Workspace options such as fonts, wrapping, and XML auto-decode are in the Payload Formatter view settings.",
    });

    new Setting(containerEl)
      .setName("Indentation size")
      .setDesc("Spaces inserted when beautifying. The view can also use 8 spaces or a tab.")
      .addDropdown((dropdown) => {
        dropdown.addOption("2", "2 spaces").addOption("4", "4 spaces").addOption("8", "8 spaces");
        dropdown.setValue(String(this.plugin.settings.indentSize));
        dropdown.onChange(async (value) => {
          if (value === "2" || value === "4" || value === "8") {
            this.plugin.settings.indentSize = Number(value) as 2 | 4 | 8;
            await this.plugin.saveSettings();
          }
        });
      });

    new Setting(containerEl)
      .setName("Indentation type")
      .setDesc("Tabs ignore the size above and indent with a single tab character.")
      .addDropdown((dropdown) => {
        dropdown.addOption("spaces", "Spaces").addOption("tabs", "Tabs");
        dropdown.setValue(this.plugin.settings.indentType);
        dropdown.onChange(async (value) => {
          if (value === "spaces" || value === "tabs") {
            this.plugin.settings.indentType = value;
            await this.plugin.saveSettings();
          }
        });
      });

    new Setting(containerEl)
      .setName("Automatic format detection")
      .setDesc("Detect JSON, XML, or SOAP from the input. Turn this off to always use the default formatter.")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.autoDetect);
        toggle.onChange(async (value) => {
          this.plugin.settings.autoDetect = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Default formatter")
      .setDesc("Used when automatic detection is off, and as the starting point for Auto Format Selection.")
      .addDropdown((dropdown) => {
        dropdown.addOption("json", "JSON").addOption("xml", "XML").addOption("soap", "SOAP");
        dropdown.setValue(this.plugin.settings.defaultFormatter);
        dropdown.onChange(async (value) => {
          if (value === "json" || value === "xml" || value === "soap") {
            this.plugin.settings.defaultFormatter = value;
            await this.plugin.saveSettings();
          }
        });
      });

    new Setting(containerEl)
      .setName("Output preference")
      .setDesc("Keep formatted text in the output panel, or also copy it to the clipboard. Editor commands replace only the selection.")
      .addDropdown((dropdown) => {
        dropdown.addOption("panel", "Show in the output panel").addOption("panel-and-clipboard", "Show in the panel and copy");
        dropdown.setValue(this.plugin.settings.outputPreference);
        dropdown.onChange(async (value) => {
          if (value === "panel" || value === "panel-and-clipboard") {
            this.plugin.settings.outputPreference = value;
            await this.plugin.saveSettings();
          }
        });
      });

    new Setting(containerEl)
      .setName("Syntax highlighting")
      .setDesc("Color JSON, XML, and SOAP in the Payload Formatter editors. Turn this off for very large payloads.")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.syntaxHighlighting);
        toggle.onChange(async (value) => {
          this.plugin.settings.syntaxHighlighting = value;
          await this.plugin.saveSettings();
        });
      });
  }
}
