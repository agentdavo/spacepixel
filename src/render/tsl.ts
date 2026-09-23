/**
 * Loose node type for shader-graph code. @types/three's TSL generics are very
 * strict (Node<"vec3"> vs Node<"float"> …) and fight with dynamic helpers that
 * build graphs from parameters; shader modules use `ShaderNode` at their
 * boundaries instead. Runtime type-checking is done by the TSL builder itself.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ShaderNode = any;
