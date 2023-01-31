import { DockerComposeBuild } from "./docker-compose";
import { DockerComposeServicePort } from "./docker-compose-port";
import { DockerComposeService } from "./docker-compose-service";
import {
  DockerComposeVolumeConfig,
  DockerComposeVolumeMount,
  IDockerComposeVolumeConfig,
} from "./docker-compose-volume";
import { decamelizeKeysRecursively } from "../util";

/**
 * Structure of a docker compose file's service before we decamelize.
 * @internal
 */
interface DockerComposeFileServiceSchema {
  readonly dependsOn?: string[];
  readonly build?: DockerComposeBuild;
  readonly image?: string;
  readonly command?: string[];
  readonly volumes?: DockerComposeVolumeMount[];
  readonly ports?: DockerComposeServicePort[];
  readonly environment?: Record<string, string>;
}

/**
 * Structure of a docker compose file before we decamelize.
 * @internal
 */
interface DockerComposeFileSchema {
  version: string;
  services: Record<string, DockerComposeFileServiceSchema>;
  volumes?: Record<string, DockerComposeVolumeConfig>;
}

export function renderDockerComposeFile(
  serviceDescriptions: Record<string, DockerComposeService>,
  version: string
): object {
  // Record volume configuration
  const volumeConfig: Record<string, DockerComposeVolumeConfig> = {};
  const volumeInfo: IDockerComposeVolumeConfig = {
    addVolumeConfiguration(
      volumeName: string,
      configuration: DockerComposeVolumeConfig
    ) {
      if (!volumeConfig[volumeName]) {
        // First volume configuration takes precedence.
        volumeConfig[volumeName] = configuration;
      }
    },
  };

  // Render service configuration
  const services: Record<string, DockerComposeFileServiceSchema> = {};
  for (const [serviceName, serviceDescription] of Object.entries(
    serviceDescriptions ?? {}
  )) {
    // Resolve the names of each dependency and check that they exist.
    // Note: They may not exist if the user made a mistake when referencing a
    // service by name via `DockerCompose.serviceName()`.
    // @see DockerCompose.serviceName
    const dependsOn = Array<string>();
    for (const dependsOnServiceName of serviceDescription.dependsOn ?? []) {
      const resolvedServiceName = dependsOnServiceName.serviceName;
      if (resolvedServiceName === serviceName) {
        throw new Error(`Service ${serviceName} cannot depend on itself`);
      }
      if (!serviceDescriptions[resolvedServiceName]) {
        throw new Error(
          `Unable to resolve service named ${resolvedServiceName} for ${serviceName}`
        );
      }

      dependsOn.push(resolvedServiceName);
    }

    // Give each volume binding a chance to bind any necessary volume
    // configuration and provide volume mount information for the service.
    const volumes: DockerComposeVolumeMount[] = [];
    for (const volumeBinding of serviceDescription.volumes ?? []) {
      volumes.push(volumeBinding.bind(volumeInfo));
    }

    // Create and store the service configuration, taking care not to create
    // object members with undefined values.
    services[serviceName] = {
      ...getObjectWithKeyAndValueIfValueIsDefined(
        "image",
        serviceDescription.image
      ),
      ...getObjectWithKeyAndValueIfValueIsDefined(
        "build",
        serviceDescription.imageBuild
      ),
      ...getObjectWithKeyAndValueIfValueIsDefined(
        "command",
        serviceDescription.command
      ),
      ...(Object.keys(serviceDescription.environment).length > 0
        ? { environment: serviceDescription.environment }
        : {}),
      ...(serviceDescription.ports.length > 0
        ? { ports: serviceDescription.ports }
        : {}),
      ...(dependsOn.length > 0 ? { dependsOn } : {}),
      ...(volumes.length > 0 ? { volumes } : {}),
    };
  }

  // Explicit with the type here because the decamelize step after this wipes
  // out types.
  const input: DockerComposeFileSchema = {
    version,
    services,
    ...(Object.keys(volumeConfig).length > 0 ? { volumes: volumeConfig } : {}),
  };

  // Change most keys to snake case.
  return decamelizeKeysRecursively(input, {
    shouldDecamelize: shouldDecamelizeDockerComposeKey,
    separator: "_",
  });
}

/**
 * Returns `{ [key]: value }` if `value` is defined, otherwise returns `{}` so
 * that object spreading can be used to generate a peculiar interface.
 * @param key
 * @param value
 */
function getObjectWithKeyAndValueIfValueIsDefined<K extends string, T>(
  key: K,
  value: T
): { K: T } | {} {
  return value !== undefined ? { [key]: value } : {};
}

/**
 * Determines whether the key at the given path should be decamelized.
 * Largely, all keys should be snake cased. But, there are some
 * exceptions for user-provided names for services, volumes, and
 * environment variables.
 *
 * @param path
 */
function shouldDecamelizeDockerComposeKey(path: string[]) {
  const poundPath = path.join("#");

  // Does not decamelize user's names.
  // services.namehere:
  // volumes.namehere:
  if (/^(services|volumes)#[^#]+$/.test(poundPath)) {
    return false;
  }

  // Does not decamelize environment variables
  // services.namehere.environment.*
  if (/^services#[^#]+#environment#/.test(poundPath)) {
    return false;
  }

  // Does not decamelize build arguments
  // services.namehere.build.args.*
  if (/^services#[^#]+#build#args#/.test(poundPath)) {
    return false;
  }

  // Otherwise, let it all decamelize.
  return true;
}