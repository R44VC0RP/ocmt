import * as p from "@clack/prompts";
import color from "picocolors";
import {
  getAvailableModels,
  cleanup,
} from "../lib/opencode";
import {
  resolveModelConfig,
  readModelConfig,
  writeModelConfig,
  getGlobalModelConfigPath,
  getRepoModelConfigPath,
  type ModelConfig,
  type ModelSelection,
} from "../lib/config";

export interface ConfigOptions {
  // Future options can go here
}

export async function configCommand(options: ConfigOptions): Promise<void> {
  p.intro(color.bgBlue(color.black(" oc config ")));

  const s = p.spinner();
  s.start("Fetching available models from OpenCode");

  let providers: any[] = [];
  try {
    const response = await getAvailableModels();
    if (response.error) {
      throw new Error("Failed to fetch models");
    }
    providers = response.data?.providers || [];
    s.stop(`Fetched ${providers.length} providers`);
  } catch (error: any) {
    s.stop("Failed to fetch models");
    p.log.error(error.message);
    p.log.warn("Make sure OpenCode is running or installed correctly.");
    cleanup();
    process.exit(1);
  }

  if (providers.length === 0) {
    p.log.warn("No providers found. Please configure OpenCode first.");
    cleanup();
    process.exit(0);
  }

  // Helper to format model display
  const formatModel = (sel?: ModelSelection) => {
    if (!sel) return color.dim("default");
    return `${color.cyan(sel.provider)}/${color.green(sel.model)}`;
  };

  while (true) {
    // Refresh current config
    const config = await resolveModelConfig();

    p.log.info(color.bold("Current Configuration:"));
    p.log.message(`  Commit:    ${formatModel(config.commit)}`);
    p.log.message(`  Changelog: ${formatModel(config.changelog)}`);
    p.log.message(`  Composer:  ${formatModel(config.composer)}`);

    const action = await p.select({
      message: "What would you like to configure?",
      options: [
        { value: "commit", label: "Commit Generation Model" },
        { value: "changelog", label: "Changelog Generation Model" },
        { value: "composer", label: "Composer Analysis Model" },
        { value: "exit", label: "Exit" },
      ],
    });

    if (p.isCancel(action) || action === "exit") {
      p.outro("Configuration saved!");
      break;
    }

    const taskType = action as keyof ModelConfig;

    // Select Provider
    const providerOptions = providers.map((prov) => ({
      value: prov.id,
      label: prov.name || prov.id,
    }));

    const selectedProvider = await p.select({
      message: `Select provider for ${taskType}:`,
      options: providerOptions,
    });

    if (p.isCancel(selectedProvider)) continue;

    const providerId = selectedProvider as string;
    const providerData = providers.find((p) => p.id === providerId);

    if (!providerData || !providerData.models) {
      p.log.error(`No models found for provider ${providerId}`);
      continue;
    }

    // Handle models (can be array or object map)
    let modelIds: string[] = [];
    if (Array.isArray(providerData.models)) {
      modelIds = providerData.models;
    } else if (typeof providerData.models === "object") {
      modelIds = Object.keys(providerData.models);
    }

    if (modelIds.length === 0) {
      p.log.error(`No models found for provider ${providerId}`);
      continue;
    }

    // Select Model
    const modelOptions = modelIds.map((model: string) => ({
      value: model,
      label: model,
    }));

    const selectedModel = await p.select({
      message: `Select model for ${taskType}:`,
      options: modelOptions,
    });

    if (p.isCancel(selectedModel)) continue;

    const modelName = selectedModel as string;

    // Select Scope
    const scope = await p.select({
      message: "Where do you want to save this configuration?",
      options: [
        { value: "repo", label: "Repository (.oc/models.json)", hint: "Overrides global config" },
        { value: "global", label: `Global (~/.oc/models.json)`, hint: "Default for all projects" },
      ],
    });

    if (p.isCancel(scope)) continue;

    try {
      let configPath: string;
      if (scope === "global") {
        configPath = getGlobalModelConfigPath();
      } else {
        configPath = await getRepoModelConfigPath();
      }

      const currentConfig = readModelConfig(configPath);
      const newConfig: ModelConfig = {
        ...currentConfig,
        [taskType]: {
          provider: providerId,
          model: modelName,
        },
      };

      writeModelConfig(configPath, newConfig);
      p.log.success(`Updated ${taskType} model to ${providerId}/${modelName} in ${scope} config`);

    } catch (error: any) {
      p.log.error(`Failed to save configuration: ${error.message}`);
    }
  }

  cleanup();
  process.exit(0);
}
