const SERVICE = "service";
const ENV = "env";
const VERSION = "version";
const MACRO_VERSION = "dd_sls_macro";

export interface TaggableResource {
  properties: {
    Tags?: { Key: string; Value: string }[];
  };
}

export interface ConfigurationWithTags {
  env?: string;
  service?: string;
  version?: string;
  tags?: string;
}

export function addDDTags(resource: TaggableResource, config: ConfigurationWithTags): void {
  const tags = resource.properties.Tags ?? [];

  const service = tags.find((tag) => tag.Key === SERVICE);
  const env = tags.find((tag) => tag.Key === ENV);
  const version = tags.find((tag) => tag.Key === VERSION);

  if (config.service && !service) {
    tags.push({ Key: SERVICE, Value: config.service });
  }
  if (config.env && !env) {
    tags.push({ Key: ENV, Value: config.env });
  }
  if (config.version && !version) {
    tags.push({ Key: VERSION, Value: config.version });
  }
  if (config.tags) {
    const tagsArray = config.tags.split(",");
    tagsArray.forEach((tag: string) => {
      const [key, value] = tag.split(":");
      const keyDoesntExsist = !tags.find((tag) => tag.Key === key);
      if (key && value && keyDoesntExsist) {
        tags.push({ Key: key, Value: value });
      }
    });
  }

  resource.properties.Tags = tags;
}

export function addMacroTag(resource: TaggableResource, version: string | undefined): void {
  if (!version) return;

  const tags = resource.properties.Tags ?? [];
  tags.push({ Value: `v${version}`, Key: MACRO_VERSION });

  resource.properties.Tags = tags;
}
