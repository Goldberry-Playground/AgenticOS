var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/worker.ts
import { AsyncResource } from "node:async_hooks";

// ../../node_modules/.pnpm/@paperclipai+plugin-sdk@2026.722.0_react@19.2.8/node_modules/@paperclipai/plugin-sdk/dist/define-plugin.js
function definePlugin(definition) {
  return Object.freeze({ definition });
}

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/external.js
var external_exports = {};
__export(external_exports, {
  BRAND: () => BRAND,
  DIRTY: () => DIRTY,
  EMPTY_PATH: () => EMPTY_PATH,
  INVALID: () => INVALID,
  NEVER: () => NEVER,
  OK: () => OK,
  ParseStatus: () => ParseStatus,
  Schema: () => ZodType,
  ZodAny: () => ZodAny,
  ZodArray: () => ZodArray,
  ZodBigInt: () => ZodBigInt,
  ZodBoolean: () => ZodBoolean,
  ZodBranded: () => ZodBranded,
  ZodCatch: () => ZodCatch,
  ZodDate: () => ZodDate,
  ZodDefault: () => ZodDefault,
  ZodDiscriminatedUnion: () => ZodDiscriminatedUnion,
  ZodEffects: () => ZodEffects,
  ZodEnum: () => ZodEnum,
  ZodError: () => ZodError,
  ZodFirstPartyTypeKind: () => ZodFirstPartyTypeKind,
  ZodFunction: () => ZodFunction,
  ZodIntersection: () => ZodIntersection,
  ZodIssueCode: () => ZodIssueCode,
  ZodLazy: () => ZodLazy,
  ZodLiteral: () => ZodLiteral,
  ZodMap: () => ZodMap,
  ZodNaN: () => ZodNaN,
  ZodNativeEnum: () => ZodNativeEnum,
  ZodNever: () => ZodNever,
  ZodNull: () => ZodNull,
  ZodNullable: () => ZodNullable,
  ZodNumber: () => ZodNumber,
  ZodObject: () => ZodObject,
  ZodOptional: () => ZodOptional,
  ZodParsedType: () => ZodParsedType,
  ZodPipeline: () => ZodPipeline,
  ZodPromise: () => ZodPromise,
  ZodReadonly: () => ZodReadonly,
  ZodRecord: () => ZodRecord,
  ZodSchema: () => ZodType,
  ZodSet: () => ZodSet,
  ZodString: () => ZodString,
  ZodSymbol: () => ZodSymbol,
  ZodTransformer: () => ZodEffects,
  ZodTuple: () => ZodTuple,
  ZodType: () => ZodType,
  ZodUndefined: () => ZodUndefined,
  ZodUnion: () => ZodUnion,
  ZodUnknown: () => ZodUnknown,
  ZodVoid: () => ZodVoid,
  addIssueToContext: () => addIssueToContext,
  any: () => anyType,
  array: () => arrayType,
  bigint: () => bigIntType,
  boolean: () => booleanType,
  coerce: () => coerce,
  custom: () => custom,
  date: () => dateType,
  datetimeRegex: () => datetimeRegex,
  defaultErrorMap: () => en_default,
  discriminatedUnion: () => discriminatedUnionType,
  effect: () => effectsType,
  enum: () => enumType,
  function: () => functionType,
  getErrorMap: () => getErrorMap,
  getParsedType: () => getParsedType,
  instanceof: () => instanceOfType,
  intersection: () => intersectionType,
  isAborted: () => isAborted,
  isAsync: () => isAsync,
  isDirty: () => isDirty,
  isValid: () => isValid,
  late: () => late,
  lazy: () => lazyType,
  literal: () => literalType,
  makeIssue: () => makeIssue,
  map: () => mapType,
  nan: () => nanType,
  nativeEnum: () => nativeEnumType,
  never: () => neverType,
  null: () => nullType,
  nullable: () => nullableType,
  number: () => numberType,
  object: () => objectType,
  objectUtil: () => objectUtil,
  oboolean: () => oboolean,
  onumber: () => onumber,
  optional: () => optionalType,
  ostring: () => ostring,
  pipeline: () => pipelineType,
  preprocess: () => preprocessType,
  promise: () => promiseType,
  quotelessJson: () => quotelessJson,
  record: () => recordType,
  set: () => setType,
  setErrorMap: () => setErrorMap,
  strictObject: () => strictObjectType,
  string: () => stringType,
  symbol: () => symbolType,
  transformer: () => effectsType,
  tuple: () => tupleType,
  undefined: () => undefinedType,
  union: () => unionType,
  unknown: () => unknownType,
  util: () => util,
  void: () => voidType
});

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/helpers/util.js
var util;
(function(util2) {
  util2.assertEqual = (_) => {
  };
  function assertIs(_arg) {
  }
  util2.assertIs = assertIs;
  function assertNever(_x) {
    throw new Error();
  }
  util2.assertNever = assertNever;
  util2.arrayToEnum = (items) => {
    const obj = {};
    for (const item of items) {
      obj[item] = item;
    }
    return obj;
  };
  util2.getValidEnumValues = (obj) => {
    const validKeys = util2.objectKeys(obj).filter((k) => typeof obj[obj[k]] !== "number");
    const filtered = {};
    for (const k of validKeys) {
      filtered[k] = obj[k];
    }
    return util2.objectValues(filtered);
  };
  util2.objectValues = (obj) => {
    return util2.objectKeys(obj).map(function(e) {
      return obj[e];
    });
  };
  util2.objectKeys = typeof Object.keys === "function" ? (obj) => Object.keys(obj) : (object) => {
    const keys = [];
    for (const key in object) {
      if (Object.prototype.hasOwnProperty.call(object, key)) {
        keys.push(key);
      }
    }
    return keys;
  };
  util2.find = (arr, checker) => {
    for (const item of arr) {
      if (checker(item))
        return item;
    }
    return void 0;
  };
  util2.isInteger = typeof Number.isInteger === "function" ? (val) => Number.isInteger(val) : (val) => typeof val === "number" && Number.isFinite(val) && Math.floor(val) === val;
  function joinValues(array, separator = " | ") {
    return array.map((val) => typeof val === "string" ? `'${val}'` : val).join(separator);
  }
  util2.joinValues = joinValues;
  util2.jsonStringifyReplacer = (_, value) => {
    if (typeof value === "bigint") {
      return value.toString();
    }
    return value;
  };
})(util || (util = {}));
var objectUtil;
(function(objectUtil2) {
  objectUtil2.mergeShapes = (first, second) => {
    return {
      ...first,
      ...second
      // second overwrites first
    };
  };
})(objectUtil || (objectUtil = {}));
var ZodParsedType = util.arrayToEnum([
  "string",
  "nan",
  "number",
  "integer",
  "float",
  "boolean",
  "date",
  "bigint",
  "symbol",
  "function",
  "undefined",
  "null",
  "array",
  "object",
  "unknown",
  "promise",
  "void",
  "never",
  "map",
  "set"
]);
var getParsedType = (data) => {
  const t = typeof data;
  switch (t) {
    case "undefined":
      return ZodParsedType.undefined;
    case "string":
      return ZodParsedType.string;
    case "number":
      return Number.isNaN(data) ? ZodParsedType.nan : ZodParsedType.number;
    case "boolean":
      return ZodParsedType.boolean;
    case "function":
      return ZodParsedType.function;
    case "bigint":
      return ZodParsedType.bigint;
    case "symbol":
      return ZodParsedType.symbol;
    case "object":
      if (Array.isArray(data)) {
        return ZodParsedType.array;
      }
      if (data === null) {
        return ZodParsedType.null;
      }
      if (data.then && typeof data.then === "function" && data.catch && typeof data.catch === "function") {
        return ZodParsedType.promise;
      }
      if (typeof Map !== "undefined" && data instanceof Map) {
        return ZodParsedType.map;
      }
      if (typeof Set !== "undefined" && data instanceof Set) {
        return ZodParsedType.set;
      }
      if (typeof Date !== "undefined" && data instanceof Date) {
        return ZodParsedType.date;
      }
      return ZodParsedType.object;
    default:
      return ZodParsedType.unknown;
  }
};

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/ZodError.js
var ZodIssueCode = util.arrayToEnum([
  "invalid_type",
  "invalid_literal",
  "custom",
  "invalid_union",
  "invalid_union_discriminator",
  "invalid_enum_value",
  "unrecognized_keys",
  "invalid_arguments",
  "invalid_return_type",
  "invalid_date",
  "invalid_string",
  "too_small",
  "too_big",
  "invalid_intersection_types",
  "not_multiple_of",
  "not_finite"
]);
var quotelessJson = (obj) => {
  const json = JSON.stringify(obj, null, 2);
  return json.replace(/"([^"]+)":/g, "$1:");
};
var ZodError = class _ZodError extends Error {
  get errors() {
    return this.issues;
  }
  constructor(issues) {
    super();
    this.issues = [];
    this.addIssue = (sub) => {
      this.issues = [...this.issues, sub];
    };
    this.addIssues = (subs = []) => {
      this.issues = [...this.issues, ...subs];
    };
    const actualProto = new.target.prototype;
    if (Object.setPrototypeOf) {
      Object.setPrototypeOf(this, actualProto);
    } else {
      this.__proto__ = actualProto;
    }
    this.name = "ZodError";
    this.issues = issues;
  }
  format(_mapper) {
    const mapper = _mapper || function(issue) {
      return issue.message;
    };
    const fieldErrors = { _errors: [] };
    const processError = (error) => {
      for (const issue of error.issues) {
        if (issue.code === "invalid_union") {
          issue.unionErrors.map(processError);
        } else if (issue.code === "invalid_return_type") {
          processError(issue.returnTypeError);
        } else if (issue.code === "invalid_arguments") {
          processError(issue.argumentsError);
        } else if (issue.path.length === 0) {
          fieldErrors._errors.push(mapper(issue));
        } else {
          let curr = fieldErrors;
          let i = 0;
          while (i < issue.path.length) {
            const el = issue.path[i];
            const terminal = i === issue.path.length - 1;
            if (!terminal) {
              curr[el] = curr[el] || { _errors: [] };
            } else {
              curr[el] = curr[el] || { _errors: [] };
              curr[el]._errors.push(mapper(issue));
            }
            curr = curr[el];
            i++;
          }
        }
      }
    };
    processError(this);
    return fieldErrors;
  }
  static assert(value) {
    if (!(value instanceof _ZodError)) {
      throw new Error(`Not a ZodError: ${value}`);
    }
  }
  toString() {
    return this.message;
  }
  get message() {
    return JSON.stringify(this.issues, util.jsonStringifyReplacer, 2);
  }
  get isEmpty() {
    return this.issues.length === 0;
  }
  flatten(mapper = (issue) => issue.message) {
    const fieldErrors = {};
    const formErrors = [];
    for (const sub of this.issues) {
      if (sub.path.length > 0) {
        const firstEl = sub.path[0];
        fieldErrors[firstEl] = fieldErrors[firstEl] || [];
        fieldErrors[firstEl].push(mapper(sub));
      } else {
        formErrors.push(mapper(sub));
      }
    }
    return { formErrors, fieldErrors };
  }
  get formErrors() {
    return this.flatten();
  }
};
ZodError.create = (issues) => {
  const error = new ZodError(issues);
  return error;
};

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/locales/en.js
var errorMap = (issue, _ctx) => {
  let message;
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      if (issue.received === ZodParsedType.undefined) {
        message = "Required";
      } else {
        message = `Expected ${issue.expected}, received ${issue.received}`;
      }
      break;
    case ZodIssueCode.invalid_literal:
      message = `Invalid literal value, expected ${JSON.stringify(issue.expected, util.jsonStringifyReplacer)}`;
      break;
    case ZodIssueCode.unrecognized_keys:
      message = `Unrecognized key(s) in object: ${util.joinValues(issue.keys, ", ")}`;
      break;
    case ZodIssueCode.invalid_union:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_union_discriminator:
      message = `Invalid discriminator value. Expected ${util.joinValues(issue.options)}`;
      break;
    case ZodIssueCode.invalid_enum_value:
      message = `Invalid enum value. Expected ${util.joinValues(issue.options)}, received '${issue.received}'`;
      break;
    case ZodIssueCode.invalid_arguments:
      message = `Invalid function arguments`;
      break;
    case ZodIssueCode.invalid_return_type:
      message = `Invalid function return type`;
      break;
    case ZodIssueCode.invalid_date:
      message = `Invalid date`;
      break;
    case ZodIssueCode.invalid_string:
      if (typeof issue.validation === "object") {
        if ("includes" in issue.validation) {
          message = `Invalid input: must include "${issue.validation.includes}"`;
          if (typeof issue.validation.position === "number") {
            message = `${message} at one or more positions greater than or equal to ${issue.validation.position}`;
          }
        } else if ("startsWith" in issue.validation) {
          message = `Invalid input: must start with "${issue.validation.startsWith}"`;
        } else if ("endsWith" in issue.validation) {
          message = `Invalid input: must end with "${issue.validation.endsWith}"`;
        } else {
          util.assertNever(issue.validation);
        }
      } else if (issue.validation !== "regex") {
        message = `Invalid ${issue.validation}`;
      } else {
        message = "Invalid";
      }
      break;
    case ZodIssueCode.too_small:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `more than`} ${issue.minimum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `over`} ${issue.minimum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "bigint")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${new Date(Number(issue.minimum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.too_big:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `less than`} ${issue.maximum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `under`} ${issue.maximum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "bigint")
        message = `BigInt must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly` : issue.inclusive ? `smaller than or equal to` : `smaller than`} ${new Date(Number(issue.maximum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.custom:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_intersection_types:
      message = `Intersection results could not be merged`;
      break;
    case ZodIssueCode.not_multiple_of:
      message = `Number must be a multiple of ${issue.multipleOf}`;
      break;
    case ZodIssueCode.not_finite:
      message = "Number must be finite";
      break;
    default:
      message = _ctx.defaultError;
      util.assertNever(issue);
  }
  return { message };
};
var en_default = errorMap;

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/errors.js
var overrideErrorMap = en_default;
function setErrorMap(map) {
  overrideErrorMap = map;
}
function getErrorMap() {
  return overrideErrorMap;
}

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/helpers/parseUtil.js
var makeIssue = (params) => {
  const { data, path: path2, errorMaps, issueData } = params;
  const fullPath = [...path2, ...issueData.path || []];
  const fullIssue = {
    ...issueData,
    path: fullPath
  };
  if (issueData.message !== void 0) {
    return {
      ...issueData,
      path: fullPath,
      message: issueData.message
    };
  }
  let errorMessage = "";
  const maps = errorMaps.filter((m) => !!m).slice().reverse();
  for (const map of maps) {
    errorMessage = map(fullIssue, { data, defaultError: errorMessage }).message;
  }
  return {
    ...issueData,
    path: fullPath,
    message: errorMessage
  };
};
var EMPTY_PATH = [];
function addIssueToContext(ctx, issueData) {
  const overrideMap = getErrorMap();
  const issue = makeIssue({
    issueData,
    data: ctx.data,
    path: ctx.path,
    errorMaps: [
      ctx.common.contextualErrorMap,
      // contextual error map is first priority
      ctx.schemaErrorMap,
      // then schema-bound map if available
      overrideMap,
      // then global override map
      overrideMap === en_default ? void 0 : en_default
      // then global default map
    ].filter((x) => !!x)
  });
  ctx.common.issues.push(issue);
}
var ParseStatus = class _ParseStatus {
  constructor() {
    this.value = "valid";
  }
  dirty() {
    if (this.value === "valid")
      this.value = "dirty";
  }
  abort() {
    if (this.value !== "aborted")
      this.value = "aborted";
  }
  static mergeArray(status, results) {
    const arrayValue = [];
    for (const s of results) {
      if (s.status === "aborted")
        return INVALID;
      if (s.status === "dirty")
        status.dirty();
      arrayValue.push(s.value);
    }
    return { status: status.value, value: arrayValue };
  }
  static async mergeObjectAsync(status, pairs) {
    const syncPairs = [];
    for (const pair of pairs) {
      const key = await pair.key;
      const value = await pair.value;
      syncPairs.push({
        key,
        value
      });
    }
    return _ParseStatus.mergeObjectSync(status, syncPairs);
  }
  static mergeObjectSync(status, pairs) {
    const finalObject = {};
    for (const pair of pairs) {
      const { key, value } = pair;
      if (key.status === "aborted")
        return INVALID;
      if (value.status === "aborted")
        return INVALID;
      if (key.status === "dirty")
        status.dirty();
      if (value.status === "dirty")
        status.dirty();
      if (key.value !== "__proto__" && (typeof value.value !== "undefined" || pair.alwaysSet)) {
        finalObject[key.value] = value.value;
      }
    }
    return { status: status.value, value: finalObject };
  }
};
var INVALID = Object.freeze({
  status: "aborted"
});
var DIRTY = (value) => ({ status: "dirty", value });
var OK = (value) => ({ status: "valid", value });
var isAborted = (x) => x.status === "aborted";
var isDirty = (x) => x.status === "dirty";
var isValid = (x) => x.status === "valid";
var isAsync = (x) => typeof Promise !== "undefined" && x instanceof Promise;

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/helpers/errorUtil.js
var errorUtil;
(function(errorUtil2) {
  errorUtil2.errToObj = (message) => typeof message === "string" ? { message } : message || {};
  errorUtil2.toString = (message) => typeof message === "string" ? message : message?.message;
})(errorUtil || (errorUtil = {}));

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/types.js
var ParseInputLazyPath = class {
  constructor(parent, value, path2, key) {
    this._cachedPath = [];
    this.parent = parent;
    this.data = value;
    this._path = path2;
    this._key = key;
  }
  get path() {
    if (!this._cachedPath.length) {
      if (Array.isArray(this._key)) {
        this._cachedPath.push(...this._path, ...this._key);
      } else {
        this._cachedPath.push(...this._path, this._key);
      }
    }
    return this._cachedPath;
  }
};
var handleResult = (ctx, result) => {
  if (isValid(result)) {
    return { success: true, data: result.value };
  } else {
    if (!ctx.common.issues.length) {
      throw new Error("Validation failed but no issues detected.");
    }
    return {
      success: false,
      get error() {
        if (this._error)
          return this._error;
        const error = new ZodError(ctx.common.issues);
        this._error = error;
        return this._error;
      }
    };
  }
};
function processCreateParams(params) {
  if (!params)
    return {};
  const { errorMap: errorMap2, invalid_type_error, required_error, description } = params;
  if (errorMap2 && (invalid_type_error || required_error)) {
    throw new Error(`Can't use "invalid_type_error" or "required_error" in conjunction with custom error map.`);
  }
  if (errorMap2)
    return { errorMap: errorMap2, description };
  const customMap = (iss, ctx) => {
    const { message } = params;
    if (iss.code === "invalid_enum_value") {
      return { message: message ?? ctx.defaultError };
    }
    if (typeof ctx.data === "undefined") {
      return { message: message ?? required_error ?? ctx.defaultError };
    }
    if (iss.code !== "invalid_type")
      return { message: ctx.defaultError };
    return { message: message ?? invalid_type_error ?? ctx.defaultError };
  };
  return { errorMap: customMap, description };
}
var ZodType = class {
  get description() {
    return this._def.description;
  }
  _getType(input) {
    return getParsedType(input.data);
  }
  _getOrReturnCtx(input, ctx) {
    return ctx || {
      common: input.parent.common,
      data: input.data,
      parsedType: getParsedType(input.data),
      schemaErrorMap: this._def.errorMap,
      path: input.path,
      parent: input.parent
    };
  }
  _processInputParams(input) {
    return {
      status: new ParseStatus(),
      ctx: {
        common: input.parent.common,
        data: input.data,
        parsedType: getParsedType(input.data),
        schemaErrorMap: this._def.errorMap,
        path: input.path,
        parent: input.parent
      }
    };
  }
  _parseSync(input) {
    const result = this._parse(input);
    if (isAsync(result)) {
      throw new Error("Synchronous parse encountered promise.");
    }
    return result;
  }
  _parseAsync(input) {
    const result = this._parse(input);
    return Promise.resolve(result);
  }
  parse(data, params) {
    const result = this.safeParse(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  safeParse(data, params) {
    const ctx = {
      common: {
        issues: [],
        async: params?.async ?? false,
        contextualErrorMap: params?.errorMap
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const result = this._parseSync({ data, path: ctx.path, parent: ctx });
    return handleResult(ctx, result);
  }
  "~validate"(data) {
    const ctx = {
      common: {
        issues: [],
        async: !!this["~standard"].async
      },
      path: [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    if (!this["~standard"].async) {
      try {
        const result = this._parseSync({ data, path: [], parent: ctx });
        return isValid(result) ? {
          value: result.value
        } : {
          issues: ctx.common.issues
        };
      } catch (err) {
        if (err?.message?.toLowerCase()?.includes("encountered")) {
          this["~standard"].async = true;
        }
        ctx.common = {
          issues: [],
          async: true
        };
      }
    }
    return this._parseAsync({ data, path: [], parent: ctx }).then((result) => isValid(result) ? {
      value: result.value
    } : {
      issues: ctx.common.issues
    });
  }
  async parseAsync(data, params) {
    const result = await this.safeParseAsync(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  async safeParseAsync(data, params) {
    const ctx = {
      common: {
        issues: [],
        contextualErrorMap: params?.errorMap,
        async: true
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const maybeAsyncResult = this._parse({ data, path: ctx.path, parent: ctx });
    const result = await (isAsync(maybeAsyncResult) ? maybeAsyncResult : Promise.resolve(maybeAsyncResult));
    return handleResult(ctx, result);
  }
  refine(check, message) {
    const getIssueProperties = (val) => {
      if (typeof message === "string" || typeof message === "undefined") {
        return { message };
      } else if (typeof message === "function") {
        return message(val);
      } else {
        return message;
      }
    };
    return this._refinement((val, ctx) => {
      const result = check(val);
      const setError = () => ctx.addIssue({
        code: ZodIssueCode.custom,
        ...getIssueProperties(val)
      });
      if (typeof Promise !== "undefined" && result instanceof Promise) {
        return result.then((data) => {
          if (!data) {
            setError();
            return false;
          } else {
            return true;
          }
        });
      }
      if (!result) {
        setError();
        return false;
      } else {
        return true;
      }
    });
  }
  refinement(check, refinementData) {
    return this._refinement((val, ctx) => {
      if (!check(val)) {
        ctx.addIssue(typeof refinementData === "function" ? refinementData(val, ctx) : refinementData);
        return false;
      } else {
        return true;
      }
    });
  }
  _refinement(refinement) {
    return new ZodEffects({
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "refinement", refinement }
    });
  }
  superRefine(refinement) {
    return this._refinement(refinement);
  }
  constructor(def) {
    this.spa = this.safeParseAsync;
    this._def = def;
    this.parse = this.parse.bind(this);
    this.safeParse = this.safeParse.bind(this);
    this.parseAsync = this.parseAsync.bind(this);
    this.safeParseAsync = this.safeParseAsync.bind(this);
    this.spa = this.spa.bind(this);
    this.refine = this.refine.bind(this);
    this.refinement = this.refinement.bind(this);
    this.superRefine = this.superRefine.bind(this);
    this.optional = this.optional.bind(this);
    this.nullable = this.nullable.bind(this);
    this.nullish = this.nullish.bind(this);
    this.array = this.array.bind(this);
    this.promise = this.promise.bind(this);
    this.or = this.or.bind(this);
    this.and = this.and.bind(this);
    this.transform = this.transform.bind(this);
    this.brand = this.brand.bind(this);
    this.default = this.default.bind(this);
    this.catch = this.catch.bind(this);
    this.describe = this.describe.bind(this);
    this.pipe = this.pipe.bind(this);
    this.readonly = this.readonly.bind(this);
    this.isNullable = this.isNullable.bind(this);
    this.isOptional = this.isOptional.bind(this);
    this["~standard"] = {
      version: 1,
      vendor: "zod",
      validate: (data) => this["~validate"](data)
    };
  }
  optional() {
    return ZodOptional.create(this, this._def);
  }
  nullable() {
    return ZodNullable.create(this, this._def);
  }
  nullish() {
    return this.nullable().optional();
  }
  array() {
    return ZodArray.create(this);
  }
  promise() {
    return ZodPromise.create(this, this._def);
  }
  or(option) {
    return ZodUnion.create([this, option], this._def);
  }
  and(incoming) {
    return ZodIntersection.create(this, incoming, this._def);
  }
  transform(transform) {
    return new ZodEffects({
      ...processCreateParams(this._def),
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "transform", transform }
    });
  }
  default(def) {
    const defaultValueFunc = typeof def === "function" ? def : () => def;
    return new ZodDefault({
      ...processCreateParams(this._def),
      innerType: this,
      defaultValue: defaultValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodDefault
    });
  }
  brand() {
    return new ZodBranded({
      typeName: ZodFirstPartyTypeKind.ZodBranded,
      type: this,
      ...processCreateParams(this._def)
    });
  }
  catch(def) {
    const catchValueFunc = typeof def === "function" ? def : () => def;
    return new ZodCatch({
      ...processCreateParams(this._def),
      innerType: this,
      catchValue: catchValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodCatch
    });
  }
  describe(description) {
    const This = this.constructor;
    return new This({
      ...this._def,
      description
    });
  }
  pipe(target) {
    return ZodPipeline.create(this, target);
  }
  readonly() {
    return ZodReadonly.create(this);
  }
  isOptional() {
    return this.safeParse(void 0).success;
  }
  isNullable() {
    return this.safeParse(null).success;
  }
};
var cuidRegex = /^c[^\s-]{8,}$/i;
var cuid2Regex = /^[0-9a-z]+$/;
var ulidRegex = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
var uuidRegex = /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/i;
var nanoidRegex = /^[a-z0-9_-]{21}$/i;
var jwtRegex = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/;
var durationRegex = /^[-+]?P(?!$)(?:(?:[-+]?\d+Y)|(?:[-+]?\d+[.,]\d+Y$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:(?:[-+]?\d+W)|(?:[-+]?\d+[.,]\d+W$))?(?:(?:[-+]?\d+D)|(?:[-+]?\d+[.,]\d+D$))?(?:T(?=[\d+-])(?:(?:[-+]?\d+H)|(?:[-+]?\d+[.,]\d+H$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:[-+]?\d+(?:[.,]\d+)?S)?)??$/;
var emailRegex = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i;
var _emojiRegex = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
var emojiRegex;
var ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv4CidrRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/(3[0-2]|[12]?[0-9])$/;
var ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
var ipv6CidrRegex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64Regex = /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/;
var base64urlRegex = /^([0-9a-zA-Z-_]{4})*(([0-9a-zA-Z-_]{2}(==)?)|([0-9a-zA-Z-_]{3}(=)?))?$/;
var dateRegexSource = `((\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\\d|3[01])|(0[469]|11)-(0[1-9]|[12]\\d|30)|(02)-(0[1-9]|1\\d|2[0-8])))`;
var dateRegex = new RegExp(`^${dateRegexSource}$`);
function timeRegexSource(args) {
  let secondsRegexSource = `[0-5]\\d`;
  if (args.precision) {
    secondsRegexSource = `${secondsRegexSource}\\.\\d{${args.precision}}`;
  } else if (args.precision == null) {
    secondsRegexSource = `${secondsRegexSource}(\\.\\d+)?`;
  }
  const secondsQuantifier = args.precision ? "+" : "?";
  return `([01]\\d|2[0-3]):[0-5]\\d(:${secondsRegexSource})${secondsQuantifier}`;
}
function timeRegex(args) {
  return new RegExp(`^${timeRegexSource(args)}$`);
}
function datetimeRegex(args) {
  let regex = `${dateRegexSource}T${timeRegexSource(args)}`;
  const opts = [];
  opts.push(args.local ? `Z?` : `Z`);
  if (args.offset)
    opts.push(`([+-]\\d{2}:?\\d{2})`);
  regex = `${regex}(${opts.join("|")})`;
  return new RegExp(`^${regex}$`);
}
function isValidIP(ip, version) {
  if ((version === "v4" || !version) && ipv4Regex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6Regex.test(ip)) {
    return true;
  }
  return false;
}
function isValidJWT(jwt, alg) {
  if (!jwtRegex.test(jwt))
    return false;
  try {
    const [header] = jwt.split(".");
    if (!header)
      return false;
    const base64 = header.replace(/-/g, "+").replace(/_/g, "/").padEnd(header.length + (4 - header.length % 4) % 4, "=");
    const decoded = JSON.parse(atob(base64));
    if (typeof decoded !== "object" || decoded === null)
      return false;
    if ("typ" in decoded && decoded?.typ !== "JWT")
      return false;
    if (!decoded.alg)
      return false;
    if (alg && decoded.alg !== alg)
      return false;
    return true;
  } catch {
    return false;
  }
}
function isValidCidr(ip, version) {
  if ((version === "v4" || !version) && ipv4CidrRegex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6CidrRegex.test(ip)) {
    return true;
  }
  return false;
}
var ZodString = class _ZodString extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = String(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.string) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.string,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.length < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.length > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "length") {
        const tooBig = input.data.length > check.value;
        const tooSmall = input.data.length < check.value;
        if (tooBig || tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          if (tooBig) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_big,
              maximum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          } else if (tooSmall) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_small,
              minimum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          }
          status.dirty();
        }
      } else if (check.kind === "email") {
        if (!emailRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "email",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "emoji") {
        if (!emojiRegex) {
          emojiRegex = new RegExp(_emojiRegex, "u");
        }
        if (!emojiRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "emoji",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "uuid") {
        if (!uuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "uuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "nanoid") {
        if (!nanoidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "nanoid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid") {
        if (!cuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid2") {
        if (!cuid2Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid2",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ulid") {
        if (!ulidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ulid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "url") {
        try {
          new URL(input.data);
        } catch {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "regex") {
        check.regex.lastIndex = 0;
        const testResult = check.regex.test(input.data);
        if (!testResult) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "regex",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "trim") {
        input.data = input.data.trim();
      } else if (check.kind === "includes") {
        if (!input.data.includes(check.value, check.position)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { includes: check.value, position: check.position },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "toLowerCase") {
        input.data = input.data.toLowerCase();
      } else if (check.kind === "toUpperCase") {
        input.data = input.data.toUpperCase();
      } else if (check.kind === "startsWith") {
        if (!input.data.startsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { startsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "endsWith") {
        if (!input.data.endsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { endsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "datetime") {
        const regex = datetimeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "datetime",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "date") {
        const regex = dateRegex;
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "date",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "time") {
        const regex = timeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "time",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "duration") {
        if (!durationRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "duration",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ip") {
        if (!isValidIP(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ip",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "jwt") {
        if (!isValidJWT(input.data, check.alg)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "jwt",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cidr") {
        if (!isValidCidr(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cidr",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64") {
        if (!base64Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64url") {
        if (!base64urlRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _regex(regex, validation, message) {
    return this.refinement((data) => regex.test(data), {
      validation,
      code: ZodIssueCode.invalid_string,
      ...errorUtil.errToObj(message)
    });
  }
  _addCheck(check) {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  email(message) {
    return this._addCheck({ kind: "email", ...errorUtil.errToObj(message) });
  }
  url(message) {
    return this._addCheck({ kind: "url", ...errorUtil.errToObj(message) });
  }
  emoji(message) {
    return this._addCheck({ kind: "emoji", ...errorUtil.errToObj(message) });
  }
  uuid(message) {
    return this._addCheck({ kind: "uuid", ...errorUtil.errToObj(message) });
  }
  nanoid(message) {
    return this._addCheck({ kind: "nanoid", ...errorUtil.errToObj(message) });
  }
  cuid(message) {
    return this._addCheck({ kind: "cuid", ...errorUtil.errToObj(message) });
  }
  cuid2(message) {
    return this._addCheck({ kind: "cuid2", ...errorUtil.errToObj(message) });
  }
  ulid(message) {
    return this._addCheck({ kind: "ulid", ...errorUtil.errToObj(message) });
  }
  base64(message) {
    return this._addCheck({ kind: "base64", ...errorUtil.errToObj(message) });
  }
  base64url(message) {
    return this._addCheck({
      kind: "base64url",
      ...errorUtil.errToObj(message)
    });
  }
  jwt(options) {
    return this._addCheck({ kind: "jwt", ...errorUtil.errToObj(options) });
  }
  ip(options) {
    return this._addCheck({ kind: "ip", ...errorUtil.errToObj(options) });
  }
  cidr(options) {
    return this._addCheck({ kind: "cidr", ...errorUtil.errToObj(options) });
  }
  datetime(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "datetime",
        precision: null,
        offset: false,
        local: false,
        message: options
      });
    }
    return this._addCheck({
      kind: "datetime",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      offset: options?.offset ?? false,
      local: options?.local ?? false,
      ...errorUtil.errToObj(options?.message)
    });
  }
  date(message) {
    return this._addCheck({ kind: "date", message });
  }
  time(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "time",
        precision: null,
        message: options
      });
    }
    return this._addCheck({
      kind: "time",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      ...errorUtil.errToObj(options?.message)
    });
  }
  duration(message) {
    return this._addCheck({ kind: "duration", ...errorUtil.errToObj(message) });
  }
  regex(regex, message) {
    return this._addCheck({
      kind: "regex",
      regex,
      ...errorUtil.errToObj(message)
    });
  }
  includes(value, options) {
    return this._addCheck({
      kind: "includes",
      value,
      position: options?.position,
      ...errorUtil.errToObj(options?.message)
    });
  }
  startsWith(value, message) {
    return this._addCheck({
      kind: "startsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  endsWith(value, message) {
    return this._addCheck({
      kind: "endsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  min(minLength, message) {
    return this._addCheck({
      kind: "min",
      value: minLength,
      ...errorUtil.errToObj(message)
    });
  }
  max(maxLength, message) {
    return this._addCheck({
      kind: "max",
      value: maxLength,
      ...errorUtil.errToObj(message)
    });
  }
  length(len, message) {
    return this._addCheck({
      kind: "length",
      value: len,
      ...errorUtil.errToObj(message)
    });
  }
  /**
   * Equivalent to `.min(1)`
   */
  nonempty(message) {
    return this.min(1, errorUtil.errToObj(message));
  }
  trim() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "trim" }]
    });
  }
  toLowerCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toLowerCase" }]
    });
  }
  toUpperCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toUpperCase" }]
    });
  }
  get isDatetime() {
    return !!this._def.checks.find((ch) => ch.kind === "datetime");
  }
  get isDate() {
    return !!this._def.checks.find((ch) => ch.kind === "date");
  }
  get isTime() {
    return !!this._def.checks.find((ch) => ch.kind === "time");
  }
  get isDuration() {
    return !!this._def.checks.find((ch) => ch.kind === "duration");
  }
  get isEmail() {
    return !!this._def.checks.find((ch) => ch.kind === "email");
  }
  get isURL() {
    return !!this._def.checks.find((ch) => ch.kind === "url");
  }
  get isEmoji() {
    return !!this._def.checks.find((ch) => ch.kind === "emoji");
  }
  get isUUID() {
    return !!this._def.checks.find((ch) => ch.kind === "uuid");
  }
  get isNANOID() {
    return !!this._def.checks.find((ch) => ch.kind === "nanoid");
  }
  get isCUID() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid");
  }
  get isCUID2() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid2");
  }
  get isULID() {
    return !!this._def.checks.find((ch) => ch.kind === "ulid");
  }
  get isIP() {
    return !!this._def.checks.find((ch) => ch.kind === "ip");
  }
  get isCIDR() {
    return !!this._def.checks.find((ch) => ch.kind === "cidr");
  }
  get isBase64() {
    return !!this._def.checks.find((ch) => ch.kind === "base64");
  }
  get isBase64url() {
    return !!this._def.checks.find((ch) => ch.kind === "base64url");
  }
  get minLength() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxLength() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodString.create = (params) => {
  return new ZodString({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodString,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
function floatSafeRemainder(val, step) {
  const valDecCount = (val.toString().split(".")[1] || "").length;
  const stepDecCount = (step.toString().split(".")[1] || "").length;
  const decCount = valDecCount > stepDecCount ? valDecCount : stepDecCount;
  const valInt = Number.parseInt(val.toFixed(decCount).replace(".", ""));
  const stepInt = Number.parseInt(step.toFixed(decCount).replace(".", ""));
  return valInt % stepInt / 10 ** decCount;
}
var ZodNumber = class _ZodNumber extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
    this.step = this.multipleOf;
  }
  _parse(input) {
    if (this._def.coerce) {
      input.data = Number(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.number) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.number,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "int") {
        if (!util.isInteger(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: "integer",
            received: "float",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (floatSafeRemainder(input.data, check.value) !== 0) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "finite") {
        if (!Number.isFinite(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_finite,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodNumber({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodNumber({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  int(message) {
    return this._addCheck({
      kind: "int",
      message: errorUtil.toString(message)
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  finite(message) {
    return this._addCheck({
      kind: "finite",
      message: errorUtil.toString(message)
    });
  }
  safe(message) {
    return this._addCheck({
      kind: "min",
      inclusive: true,
      value: Number.MIN_SAFE_INTEGER,
      message: errorUtil.toString(message)
    })._addCheck({
      kind: "max",
      inclusive: true,
      value: Number.MAX_SAFE_INTEGER,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
  get isInt() {
    return !!this._def.checks.find((ch) => ch.kind === "int" || ch.kind === "multipleOf" && util.isInteger(ch.value));
  }
  get isFinite() {
    let max = null;
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "finite" || ch.kind === "int" || ch.kind === "multipleOf") {
        return true;
      } else if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      } else if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return Number.isFinite(min) && Number.isFinite(max);
  }
};
ZodNumber.create = (params) => {
  return new ZodNumber({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodNumber,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};
var ZodBigInt = class _ZodBigInt extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
  }
  _parse(input) {
    if (this._def.coerce) {
      try {
        input.data = BigInt(input.data);
      } catch {
        return this._getInvalidInput(input);
      }
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.bigint) {
      return this._getInvalidInput(input);
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            type: "bigint",
            minimum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            type: "bigint",
            maximum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (input.data % check.value !== BigInt(0)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _getInvalidInput(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.bigint,
      received: ctx.parsedType
    });
    return INVALID;
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodBigInt({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodBigInt({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodBigInt.create = (params) => {
  return new ZodBigInt({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodBigInt,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
var ZodBoolean = class extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = Boolean(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.boolean) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.boolean,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodBoolean.create = (params) => {
  return new ZodBoolean({
    typeName: ZodFirstPartyTypeKind.ZodBoolean,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};
var ZodDate = class _ZodDate extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = new Date(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.date) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.date,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    if (Number.isNaN(input.data.getTime())) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_date
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.getTime() < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            message: check.message,
            inclusive: true,
            exact: false,
            minimum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.getTime() > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            message: check.message,
            inclusive: true,
            exact: false,
            maximum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return {
      status: status.value,
      value: new Date(input.data.getTime())
    };
  }
  _addCheck(check) {
    return new _ZodDate({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  min(minDate, message) {
    return this._addCheck({
      kind: "min",
      value: minDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  max(maxDate, message) {
    return this._addCheck({
      kind: "max",
      value: maxDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  get minDate() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min != null ? new Date(min) : null;
  }
  get maxDate() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max != null ? new Date(max) : null;
  }
};
ZodDate.create = (params) => {
  return new ZodDate({
    checks: [],
    coerce: params?.coerce || false,
    typeName: ZodFirstPartyTypeKind.ZodDate,
    ...processCreateParams(params)
  });
};
var ZodSymbol = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.symbol) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.symbol,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodSymbol.create = (params) => {
  return new ZodSymbol({
    typeName: ZodFirstPartyTypeKind.ZodSymbol,
    ...processCreateParams(params)
  });
};
var ZodUndefined = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.undefined,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodUndefined.create = (params) => {
  return new ZodUndefined({
    typeName: ZodFirstPartyTypeKind.ZodUndefined,
    ...processCreateParams(params)
  });
};
var ZodNull = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.null) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.null,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodNull.create = (params) => {
  return new ZodNull({
    typeName: ZodFirstPartyTypeKind.ZodNull,
    ...processCreateParams(params)
  });
};
var ZodAny = class extends ZodType {
  constructor() {
    super(...arguments);
    this._any = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodAny.create = (params) => {
  return new ZodAny({
    typeName: ZodFirstPartyTypeKind.ZodAny,
    ...processCreateParams(params)
  });
};
var ZodUnknown = class extends ZodType {
  constructor() {
    super(...arguments);
    this._unknown = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodUnknown.create = (params) => {
  return new ZodUnknown({
    typeName: ZodFirstPartyTypeKind.ZodUnknown,
    ...processCreateParams(params)
  });
};
var ZodNever = class extends ZodType {
  _parse(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.never,
      received: ctx.parsedType
    });
    return INVALID;
  }
};
ZodNever.create = (params) => {
  return new ZodNever({
    typeName: ZodFirstPartyTypeKind.ZodNever,
    ...processCreateParams(params)
  });
};
var ZodVoid = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.void,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodVoid.create = (params) => {
  return new ZodVoid({
    typeName: ZodFirstPartyTypeKind.ZodVoid,
    ...processCreateParams(params)
  });
};
var ZodArray = class _ZodArray extends ZodType {
  _parse(input) {
    const { ctx, status } = this._processInputParams(input);
    const def = this._def;
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (def.exactLength !== null) {
      const tooBig = ctx.data.length > def.exactLength.value;
      const tooSmall = ctx.data.length < def.exactLength.value;
      if (tooBig || tooSmall) {
        addIssueToContext(ctx, {
          code: tooBig ? ZodIssueCode.too_big : ZodIssueCode.too_small,
          minimum: tooSmall ? def.exactLength.value : void 0,
          maximum: tooBig ? def.exactLength.value : void 0,
          type: "array",
          inclusive: true,
          exact: true,
          message: def.exactLength.message
        });
        status.dirty();
      }
    }
    if (def.minLength !== null) {
      if (ctx.data.length < def.minLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.minLength.message
        });
        status.dirty();
      }
    }
    if (def.maxLength !== null) {
      if (ctx.data.length > def.maxLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.maxLength.message
        });
        status.dirty();
      }
    }
    if (ctx.common.async) {
      return Promise.all([...ctx.data].map((item, i) => {
        return def.type._parseAsync(new ParseInputLazyPath(ctx, item, ctx.path, i));
      })).then((result2) => {
        return ParseStatus.mergeArray(status, result2);
      });
    }
    const result = [...ctx.data].map((item, i) => {
      return def.type._parseSync(new ParseInputLazyPath(ctx, item, ctx.path, i));
    });
    return ParseStatus.mergeArray(status, result);
  }
  get element() {
    return this._def.type;
  }
  min(minLength, message) {
    return new _ZodArray({
      ...this._def,
      minLength: { value: minLength, message: errorUtil.toString(message) }
    });
  }
  max(maxLength, message) {
    return new _ZodArray({
      ...this._def,
      maxLength: { value: maxLength, message: errorUtil.toString(message) }
    });
  }
  length(len, message) {
    return new _ZodArray({
      ...this._def,
      exactLength: { value: len, message: errorUtil.toString(message) }
    });
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodArray.create = (schema, params) => {
  return new ZodArray({
    type: schema,
    minLength: null,
    maxLength: null,
    exactLength: null,
    typeName: ZodFirstPartyTypeKind.ZodArray,
    ...processCreateParams(params)
  });
};
function deepPartialify(schema) {
  if (schema instanceof ZodObject) {
    const newShape = {};
    for (const key in schema.shape) {
      const fieldSchema = schema.shape[key];
      newShape[key] = ZodOptional.create(deepPartialify(fieldSchema));
    }
    return new ZodObject({
      ...schema._def,
      shape: () => newShape
    });
  } else if (schema instanceof ZodArray) {
    return new ZodArray({
      ...schema._def,
      type: deepPartialify(schema.element)
    });
  } else if (schema instanceof ZodOptional) {
    return ZodOptional.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodNullable) {
    return ZodNullable.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodTuple) {
    return ZodTuple.create(schema.items.map((item) => deepPartialify(item)));
  } else {
    return schema;
  }
}
var ZodObject = class _ZodObject extends ZodType {
  constructor() {
    super(...arguments);
    this._cached = null;
    this.nonstrict = this.passthrough;
    this.augment = this.extend;
  }
  _getCached() {
    if (this._cached !== null)
      return this._cached;
    const shape = this._def.shape();
    const keys = util.objectKeys(shape);
    this._cached = { shape, keys };
    return this._cached;
  }
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.object) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const { status, ctx } = this._processInputParams(input);
    const { shape, keys: shapeKeys } = this._getCached();
    const extraKeys = [];
    if (!(this._def.catchall instanceof ZodNever && this._def.unknownKeys === "strip")) {
      for (const key in ctx.data) {
        if (!shapeKeys.includes(key)) {
          extraKeys.push(key);
        }
      }
    }
    const pairs = [];
    for (const key of shapeKeys) {
      const keyValidator = shape[key];
      const value = ctx.data[key];
      pairs.push({
        key: { status: "valid", value: key },
        value: keyValidator._parse(new ParseInputLazyPath(ctx, value, ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (this._def.catchall instanceof ZodNever) {
      const unknownKeys = this._def.unknownKeys;
      if (unknownKeys === "passthrough") {
        for (const key of extraKeys) {
          pairs.push({
            key: { status: "valid", value: key },
            value: { status: "valid", value: ctx.data[key] }
          });
        }
      } else if (unknownKeys === "strict") {
        if (extraKeys.length > 0) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.unrecognized_keys,
            keys: extraKeys
          });
          status.dirty();
        }
      } else if (unknownKeys === "strip") {
      } else {
        throw new Error(`Internal ZodObject error: invalid unknownKeys value.`);
      }
    } else {
      const catchall = this._def.catchall;
      for (const key of extraKeys) {
        const value = ctx.data[key];
        pairs.push({
          key: { status: "valid", value: key },
          value: catchall._parse(
            new ParseInputLazyPath(ctx, value, ctx.path, key)
            //, ctx.child(key), value, getParsedType(value)
          ),
          alwaysSet: key in ctx.data
        });
      }
    }
    if (ctx.common.async) {
      return Promise.resolve().then(async () => {
        const syncPairs = [];
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          syncPairs.push({
            key,
            value,
            alwaysSet: pair.alwaysSet
          });
        }
        return syncPairs;
      }).then((syncPairs) => {
        return ParseStatus.mergeObjectSync(status, syncPairs);
      });
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get shape() {
    return this._def.shape();
  }
  strict(message) {
    errorUtil.errToObj;
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strict",
      ...message !== void 0 ? {
        errorMap: (issue, ctx) => {
          const defaultError = this._def.errorMap?.(issue, ctx).message ?? ctx.defaultError;
          if (issue.code === "unrecognized_keys")
            return {
              message: errorUtil.errToObj(message).message ?? defaultError
            };
          return {
            message: defaultError
          };
        }
      } : {}
    });
  }
  strip() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strip"
    });
  }
  passthrough() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "passthrough"
    });
  }
  // const AugmentFactory =
  //   <Def extends ZodObjectDef>(def: Def) =>
  //   <Augmentation extends ZodRawShape>(
  //     augmentation: Augmentation
  //   ): ZodObject<
  //     extendShape<ReturnType<Def["shape"]>, Augmentation>,
  //     Def["unknownKeys"],
  //     Def["catchall"]
  //   > => {
  //     return new ZodObject({
  //       ...def,
  //       shape: () => ({
  //         ...def.shape(),
  //         ...augmentation,
  //       }),
  //     }) as any;
  //   };
  extend(augmentation) {
    return new _ZodObject({
      ...this._def,
      shape: () => ({
        ...this._def.shape(),
        ...augmentation
      })
    });
  }
  /**
   * Prior to zod@1.0.12 there was a bug in the
   * inferred type of merged objects. Please
   * upgrade if you are experiencing issues.
   */
  merge(merging) {
    const merged = new _ZodObject({
      unknownKeys: merging._def.unknownKeys,
      catchall: merging._def.catchall,
      shape: () => ({
        ...this._def.shape(),
        ...merging._def.shape()
      }),
      typeName: ZodFirstPartyTypeKind.ZodObject
    });
    return merged;
  }
  // merge<
  //   Incoming extends AnyZodObject,
  //   Augmentation extends Incoming["shape"],
  //   NewOutput extends {
  //     [k in keyof Augmentation | keyof Output]: k extends keyof Augmentation
  //       ? Augmentation[k]["_output"]
  //       : k extends keyof Output
  //       ? Output[k]
  //       : never;
  //   },
  //   NewInput extends {
  //     [k in keyof Augmentation | keyof Input]: k extends keyof Augmentation
  //       ? Augmentation[k]["_input"]
  //       : k extends keyof Input
  //       ? Input[k]
  //       : never;
  //   }
  // >(
  //   merging: Incoming
  // ): ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"],
  //   NewOutput,
  //   NewInput
  // > {
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  setKey(key, schema) {
    return this.augment({ [key]: schema });
  }
  // merge<Incoming extends AnyZodObject>(
  //   merging: Incoming
  // ): //ZodObject<T & Incoming["_shape"], UnknownKeys, Catchall> = (merging) => {
  // ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"]
  // > {
  //   // const mergedShape = objectUtil.mergeShapes(
  //   //   this._def.shape(),
  //   //   merging._def.shape()
  //   // );
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  catchall(index) {
    return new _ZodObject({
      ...this._def,
      catchall: index
    });
  }
  pick(mask) {
    const shape = {};
    for (const key of util.objectKeys(mask)) {
      if (mask[key] && this.shape[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  omit(mask) {
    const shape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (!mask[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  /**
   * @deprecated
   */
  deepPartial() {
    return deepPartialify(this);
  }
  partial(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      const fieldSchema = this.shape[key];
      if (mask && !mask[key]) {
        newShape[key] = fieldSchema;
      } else {
        newShape[key] = fieldSchema.optional();
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  required(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (mask && !mask[key]) {
        newShape[key] = this.shape[key];
      } else {
        const fieldSchema = this.shape[key];
        let newField = fieldSchema;
        while (newField instanceof ZodOptional) {
          newField = newField._def.innerType;
        }
        newShape[key] = newField;
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  keyof() {
    return createZodEnum(util.objectKeys(this.shape));
  }
};
ZodObject.create = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.strictCreate = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strict",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.lazycreate = (shape, params) => {
  return new ZodObject({
    shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
var ZodUnion = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const options = this._def.options;
    function handleResults(results) {
      for (const result of results) {
        if (result.result.status === "valid") {
          return result.result;
        }
      }
      for (const result of results) {
        if (result.result.status === "dirty") {
          ctx.common.issues.push(...result.ctx.common.issues);
          return result.result;
        }
      }
      const unionErrors = results.map((result) => new ZodError(result.ctx.common.issues));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return Promise.all(options.map(async (option) => {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        return {
          result: await option._parseAsync({
            data: ctx.data,
            path: ctx.path,
            parent: childCtx
          }),
          ctx: childCtx
        };
      })).then(handleResults);
    } else {
      let dirty = void 0;
      const issues = [];
      for (const option of options) {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        const result = option._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: childCtx
        });
        if (result.status === "valid") {
          return result;
        } else if (result.status === "dirty" && !dirty) {
          dirty = { result, ctx: childCtx };
        }
        if (childCtx.common.issues.length) {
          issues.push(childCtx.common.issues);
        }
      }
      if (dirty) {
        ctx.common.issues.push(...dirty.ctx.common.issues);
        return dirty.result;
      }
      const unionErrors = issues.map((issues2) => new ZodError(issues2));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
  }
  get options() {
    return this._def.options;
  }
};
ZodUnion.create = (types, params) => {
  return new ZodUnion({
    options: types,
    typeName: ZodFirstPartyTypeKind.ZodUnion,
    ...processCreateParams(params)
  });
};
var getDiscriminator = (type) => {
  if (type instanceof ZodLazy) {
    return getDiscriminator(type.schema);
  } else if (type instanceof ZodEffects) {
    return getDiscriminator(type.innerType());
  } else if (type instanceof ZodLiteral) {
    return [type.value];
  } else if (type instanceof ZodEnum) {
    return type.options;
  } else if (type instanceof ZodNativeEnum) {
    return util.objectValues(type.enum);
  } else if (type instanceof ZodDefault) {
    return getDiscriminator(type._def.innerType);
  } else if (type instanceof ZodUndefined) {
    return [void 0];
  } else if (type instanceof ZodNull) {
    return [null];
  } else if (type instanceof ZodOptional) {
    return [void 0, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodNullable) {
    return [null, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodBranded) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodReadonly) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodCatch) {
    return getDiscriminator(type._def.innerType);
  } else {
    return [];
  }
};
var ZodDiscriminatedUnion = class _ZodDiscriminatedUnion extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const discriminator = this.discriminator;
    const discriminatorValue = ctx.data[discriminator];
    const option = this.optionsMap.get(discriminatorValue);
    if (!option) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union_discriminator,
        options: Array.from(this.optionsMap.keys()),
        path: [discriminator]
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return option._parseAsync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    } else {
      return option._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    }
  }
  get discriminator() {
    return this._def.discriminator;
  }
  get options() {
    return this._def.options;
  }
  get optionsMap() {
    return this._def.optionsMap;
  }
  /**
   * The constructor of the discriminated union schema. Its behaviour is very similar to that of the normal z.union() constructor.
   * However, it only allows a union of objects, all of which need to share a discriminator property. This property must
   * have a different value for each object in the union.
   * @param discriminator the name of the discriminator property
   * @param types an array of object schemas
   * @param params
   */
  static create(discriminator, options, params) {
    const optionsMap = /* @__PURE__ */ new Map();
    for (const type of options) {
      const discriminatorValues = getDiscriminator(type.shape[discriminator]);
      if (!discriminatorValues.length) {
        throw new Error(`A discriminator value for key \`${discriminator}\` could not be extracted from all schema options`);
      }
      for (const value of discriminatorValues) {
        if (optionsMap.has(value)) {
          throw new Error(`Discriminator property ${String(discriminator)} has duplicate value ${String(value)}`);
        }
        optionsMap.set(value, type);
      }
    }
    return new _ZodDiscriminatedUnion({
      typeName: ZodFirstPartyTypeKind.ZodDiscriminatedUnion,
      discriminator,
      options,
      optionsMap,
      ...processCreateParams(params)
    });
  }
};
function mergeValues(a, b) {
  const aType = getParsedType(a);
  const bType = getParsedType(b);
  if (a === b) {
    return { valid: true, data: a };
  } else if (aType === ZodParsedType.object && bType === ZodParsedType.object) {
    const bKeys = util.objectKeys(b);
    const sharedKeys = util.objectKeys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    for (const key of sharedKeys) {
      const sharedValue = mergeValues(a[key], b[key]);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  } else if (aType === ZodParsedType.array && bType === ZodParsedType.array) {
    if (a.length !== b.length) {
      return { valid: false };
    }
    const newArray = [];
    for (let index = 0; index < a.length; index++) {
      const itemA = a[index];
      const itemB = b[index];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  } else if (aType === ZodParsedType.date && bType === ZodParsedType.date && +a === +b) {
    return { valid: true, data: a };
  } else {
    return { valid: false };
  }
}
var ZodIntersection = class extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const handleParsed = (parsedLeft, parsedRight) => {
      if (isAborted(parsedLeft) || isAborted(parsedRight)) {
        return INVALID;
      }
      const merged = mergeValues(parsedLeft.value, parsedRight.value);
      if (!merged.valid) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_intersection_types
        });
        return INVALID;
      }
      if (isDirty(parsedLeft) || isDirty(parsedRight)) {
        status.dirty();
      }
      return { status: status.value, value: merged.data };
    };
    if (ctx.common.async) {
      return Promise.all([
        this._def.left._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        }),
        this._def.right._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        })
      ]).then(([left, right]) => handleParsed(left, right));
    } else {
      return handleParsed(this._def.left._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }), this._def.right._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }));
    }
  }
};
ZodIntersection.create = (left, right, params) => {
  return new ZodIntersection({
    left,
    right,
    typeName: ZodFirstPartyTypeKind.ZodIntersection,
    ...processCreateParams(params)
  });
};
var ZodTuple = class _ZodTuple extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (ctx.data.length < this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_small,
        minimum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      return INVALID;
    }
    const rest = this._def.rest;
    if (!rest && ctx.data.length > this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_big,
        maximum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      status.dirty();
    }
    const items = [...ctx.data].map((item, itemIndex) => {
      const schema = this._def.items[itemIndex] || this._def.rest;
      if (!schema)
        return null;
      return schema._parse(new ParseInputLazyPath(ctx, item, ctx.path, itemIndex));
    }).filter((x) => !!x);
    if (ctx.common.async) {
      return Promise.all(items).then((results) => {
        return ParseStatus.mergeArray(status, results);
      });
    } else {
      return ParseStatus.mergeArray(status, items);
    }
  }
  get items() {
    return this._def.items;
  }
  rest(rest) {
    return new _ZodTuple({
      ...this._def,
      rest
    });
  }
};
ZodTuple.create = (schemas, params) => {
  if (!Array.isArray(schemas)) {
    throw new Error("You must pass an array of schemas to z.tuple([ ... ])");
  }
  return new ZodTuple({
    items: schemas,
    typeName: ZodFirstPartyTypeKind.ZodTuple,
    rest: null,
    ...processCreateParams(params)
  });
};
var ZodRecord = class _ZodRecord extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const pairs = [];
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    for (const key in ctx.data) {
      pairs.push({
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, key)),
        value: valueType._parse(new ParseInputLazyPath(ctx, ctx.data[key], ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (ctx.common.async) {
      return ParseStatus.mergeObjectAsync(status, pairs);
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get element() {
    return this._def.valueType;
  }
  static create(first, second, third) {
    if (second instanceof ZodType) {
      return new _ZodRecord({
        keyType: first,
        valueType: second,
        typeName: ZodFirstPartyTypeKind.ZodRecord,
        ...processCreateParams(third)
      });
    }
    return new _ZodRecord({
      keyType: ZodString.create(),
      valueType: first,
      typeName: ZodFirstPartyTypeKind.ZodRecord,
      ...processCreateParams(second)
    });
  }
};
var ZodMap = class extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.map) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.map,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    const pairs = [...ctx.data.entries()].map(([key, value], index) => {
      return {
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, [index, "key"])),
        value: valueType._parse(new ParseInputLazyPath(ctx, value, ctx.path, [index, "value"]))
      };
    });
    if (ctx.common.async) {
      const finalMap = /* @__PURE__ */ new Map();
      return Promise.resolve().then(async () => {
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          if (key.status === "aborted" || value.status === "aborted") {
            return INVALID;
          }
          if (key.status === "dirty" || value.status === "dirty") {
            status.dirty();
          }
          finalMap.set(key.value, value.value);
        }
        return { status: status.value, value: finalMap };
      });
    } else {
      const finalMap = /* @__PURE__ */ new Map();
      for (const pair of pairs) {
        const key = pair.key;
        const value = pair.value;
        if (key.status === "aborted" || value.status === "aborted") {
          return INVALID;
        }
        if (key.status === "dirty" || value.status === "dirty") {
          status.dirty();
        }
        finalMap.set(key.value, value.value);
      }
      return { status: status.value, value: finalMap };
    }
  }
};
ZodMap.create = (keyType, valueType, params) => {
  return new ZodMap({
    valueType,
    keyType,
    typeName: ZodFirstPartyTypeKind.ZodMap,
    ...processCreateParams(params)
  });
};
var ZodSet = class _ZodSet extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.set) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.set,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const def = this._def;
    if (def.minSize !== null) {
      if (ctx.data.size < def.minSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.minSize.message
        });
        status.dirty();
      }
    }
    if (def.maxSize !== null) {
      if (ctx.data.size > def.maxSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.maxSize.message
        });
        status.dirty();
      }
    }
    const valueType = this._def.valueType;
    function finalizeSet(elements2) {
      const parsedSet = /* @__PURE__ */ new Set();
      for (const element of elements2) {
        if (element.status === "aborted")
          return INVALID;
        if (element.status === "dirty")
          status.dirty();
        parsedSet.add(element.value);
      }
      return { status: status.value, value: parsedSet };
    }
    const elements = [...ctx.data.values()].map((item, i) => valueType._parse(new ParseInputLazyPath(ctx, item, ctx.path, i)));
    if (ctx.common.async) {
      return Promise.all(elements).then((elements2) => finalizeSet(elements2));
    } else {
      return finalizeSet(elements);
    }
  }
  min(minSize, message) {
    return new _ZodSet({
      ...this._def,
      minSize: { value: minSize, message: errorUtil.toString(message) }
    });
  }
  max(maxSize, message) {
    return new _ZodSet({
      ...this._def,
      maxSize: { value: maxSize, message: errorUtil.toString(message) }
    });
  }
  size(size, message) {
    return this.min(size, message).max(size, message);
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodSet.create = (valueType, params) => {
  return new ZodSet({
    valueType,
    minSize: null,
    maxSize: null,
    typeName: ZodFirstPartyTypeKind.ZodSet,
    ...processCreateParams(params)
  });
};
var ZodFunction = class _ZodFunction extends ZodType {
  constructor() {
    super(...arguments);
    this.validate = this.implement;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.function) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.function,
        received: ctx.parsedType
      });
      return INVALID;
    }
    function makeArgsIssue(args, error) {
      return makeIssue({
        data: args,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_arguments,
          argumentsError: error
        }
      });
    }
    function makeReturnsIssue(returns, error) {
      return makeIssue({
        data: returns,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_return_type,
          returnTypeError: error
        }
      });
    }
    const params = { errorMap: ctx.common.contextualErrorMap };
    const fn = ctx.data;
    if (this._def.returns instanceof ZodPromise) {
      const me = this;
      return OK(async function(...args) {
        const error = new ZodError([]);
        const parsedArgs = await me._def.args.parseAsync(args, params).catch((e) => {
          error.addIssue(makeArgsIssue(args, e));
          throw error;
        });
        const result = await Reflect.apply(fn, this, parsedArgs);
        const parsedReturns = await me._def.returns._def.type.parseAsync(result, params).catch((e) => {
          error.addIssue(makeReturnsIssue(result, e));
          throw error;
        });
        return parsedReturns;
      });
    } else {
      const me = this;
      return OK(function(...args) {
        const parsedArgs = me._def.args.safeParse(args, params);
        if (!parsedArgs.success) {
          throw new ZodError([makeArgsIssue(args, parsedArgs.error)]);
        }
        const result = Reflect.apply(fn, this, parsedArgs.data);
        const parsedReturns = me._def.returns.safeParse(result, params);
        if (!parsedReturns.success) {
          throw new ZodError([makeReturnsIssue(result, parsedReturns.error)]);
        }
        return parsedReturns.data;
      });
    }
  }
  parameters() {
    return this._def.args;
  }
  returnType() {
    return this._def.returns;
  }
  args(...items) {
    return new _ZodFunction({
      ...this._def,
      args: ZodTuple.create(items).rest(ZodUnknown.create())
    });
  }
  returns(returnType) {
    return new _ZodFunction({
      ...this._def,
      returns: returnType
    });
  }
  implement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  strictImplement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  static create(args, returns, params) {
    return new _ZodFunction({
      args: args ? args : ZodTuple.create([]).rest(ZodUnknown.create()),
      returns: returns || ZodUnknown.create(),
      typeName: ZodFirstPartyTypeKind.ZodFunction,
      ...processCreateParams(params)
    });
  }
};
var ZodLazy = class extends ZodType {
  get schema() {
    return this._def.getter();
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const lazySchema = this._def.getter();
    return lazySchema._parse({ data: ctx.data, path: ctx.path, parent: ctx });
  }
};
ZodLazy.create = (getter, params) => {
  return new ZodLazy({
    getter,
    typeName: ZodFirstPartyTypeKind.ZodLazy,
    ...processCreateParams(params)
  });
};
var ZodLiteral = class extends ZodType {
  _parse(input) {
    if (input.data !== this._def.value) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_literal,
        expected: this._def.value
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
  get value() {
    return this._def.value;
  }
};
ZodLiteral.create = (value, params) => {
  return new ZodLiteral({
    value,
    typeName: ZodFirstPartyTypeKind.ZodLiteral,
    ...processCreateParams(params)
  });
};
function createZodEnum(values, params) {
  return new ZodEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodEnum,
    ...processCreateParams(params)
  });
}
var ZodEnum = class _ZodEnum extends ZodType {
  _parse(input) {
    if (typeof input.data !== "string") {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(this._def.values);
    }
    if (!this._cache.has(input.data)) {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get options() {
    return this._def.values;
  }
  get enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Values() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  extract(values, newDef = this._def) {
    return _ZodEnum.create(values, {
      ...this._def,
      ...newDef
    });
  }
  exclude(values, newDef = this._def) {
    return _ZodEnum.create(this.options.filter((opt) => !values.includes(opt)), {
      ...this._def,
      ...newDef
    });
  }
};
ZodEnum.create = createZodEnum;
var ZodNativeEnum = class extends ZodType {
  _parse(input) {
    const nativeEnumValues = util.getValidEnumValues(this._def.values);
    const ctx = this._getOrReturnCtx(input);
    if (ctx.parsedType !== ZodParsedType.string && ctx.parsedType !== ZodParsedType.number) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(util.getValidEnumValues(this._def.values));
    }
    if (!this._cache.has(input.data)) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get enum() {
    return this._def.values;
  }
};
ZodNativeEnum.create = (values, params) => {
  return new ZodNativeEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodNativeEnum,
    ...processCreateParams(params)
  });
};
var ZodPromise = class extends ZodType {
  unwrap() {
    return this._def.type;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.promise && ctx.common.async === false) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.promise,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const promisified = ctx.parsedType === ZodParsedType.promise ? ctx.data : Promise.resolve(ctx.data);
    return OK(promisified.then((data) => {
      return this._def.type.parseAsync(data, {
        path: ctx.path,
        errorMap: ctx.common.contextualErrorMap
      });
    }));
  }
};
ZodPromise.create = (schema, params) => {
  return new ZodPromise({
    type: schema,
    typeName: ZodFirstPartyTypeKind.ZodPromise,
    ...processCreateParams(params)
  });
};
var ZodEffects = class extends ZodType {
  innerType() {
    return this._def.schema;
  }
  sourceType() {
    return this._def.schema._def.typeName === ZodFirstPartyTypeKind.ZodEffects ? this._def.schema.sourceType() : this._def.schema;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const effect = this._def.effect || null;
    const checkCtx = {
      addIssue: (arg) => {
        addIssueToContext(ctx, arg);
        if (arg.fatal) {
          status.abort();
        } else {
          status.dirty();
        }
      },
      get path() {
        return ctx.path;
      }
    };
    checkCtx.addIssue = checkCtx.addIssue.bind(checkCtx);
    if (effect.type === "preprocess") {
      const processed = effect.transform(ctx.data, checkCtx);
      if (ctx.common.async) {
        return Promise.resolve(processed).then(async (processed2) => {
          if (status.value === "aborted")
            return INVALID;
          const result = await this._def.schema._parseAsync({
            data: processed2,
            path: ctx.path,
            parent: ctx
          });
          if (result.status === "aborted")
            return INVALID;
          if (result.status === "dirty")
            return DIRTY(result.value);
          if (status.value === "dirty")
            return DIRTY(result.value);
          return result;
        });
      } else {
        if (status.value === "aborted")
          return INVALID;
        const result = this._def.schema._parseSync({
          data: processed,
          path: ctx.path,
          parent: ctx
        });
        if (result.status === "aborted")
          return INVALID;
        if (result.status === "dirty")
          return DIRTY(result.value);
        if (status.value === "dirty")
          return DIRTY(result.value);
        return result;
      }
    }
    if (effect.type === "refinement") {
      const executeRefinement = (acc) => {
        const result = effect.refinement(acc, checkCtx);
        if (ctx.common.async) {
          return Promise.resolve(result);
        }
        if (result instanceof Promise) {
          throw new Error("Async refinement encountered during synchronous parse operation. Use .parseAsync instead.");
        }
        return acc;
      };
      if (ctx.common.async === false) {
        const inner = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inner.status === "aborted")
          return INVALID;
        if (inner.status === "dirty")
          status.dirty();
        executeRefinement(inner.value);
        return { status: status.value, value: inner.value };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((inner) => {
          if (inner.status === "aborted")
            return INVALID;
          if (inner.status === "dirty")
            status.dirty();
          return executeRefinement(inner.value).then(() => {
            return { status: status.value, value: inner.value };
          });
        });
      }
    }
    if (effect.type === "transform") {
      if (ctx.common.async === false) {
        const base = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (!isValid(base))
          return INVALID;
        const result = effect.transform(base.value, checkCtx);
        if (result instanceof Promise) {
          throw new Error(`Asynchronous transform encountered during synchronous parse operation. Use .parseAsync instead.`);
        }
        return { status: status.value, value: result };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((base) => {
          if (!isValid(base))
            return INVALID;
          return Promise.resolve(effect.transform(base.value, checkCtx)).then((result) => ({
            status: status.value,
            value: result
          }));
        });
      }
    }
    util.assertNever(effect);
  }
};
ZodEffects.create = (schema, effect, params) => {
  return new ZodEffects({
    schema,
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    effect,
    ...processCreateParams(params)
  });
};
ZodEffects.createWithPreprocess = (preprocess, schema, params) => {
  return new ZodEffects({
    schema,
    effect: { type: "preprocess", transform: preprocess },
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    ...processCreateParams(params)
  });
};
var ZodOptional = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.undefined) {
      return OK(void 0);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodOptional.create = (type, params) => {
  return new ZodOptional({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodOptional,
    ...processCreateParams(params)
  });
};
var ZodNullable = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.null) {
      return OK(null);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodNullable.create = (type, params) => {
  return new ZodNullable({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodNullable,
    ...processCreateParams(params)
  });
};
var ZodDefault = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    let data = ctx.data;
    if (ctx.parsedType === ZodParsedType.undefined) {
      data = this._def.defaultValue();
    }
    return this._def.innerType._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  removeDefault() {
    return this._def.innerType;
  }
};
ZodDefault.create = (type, params) => {
  return new ZodDefault({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodDefault,
    defaultValue: typeof params.default === "function" ? params.default : () => params.default,
    ...processCreateParams(params)
  });
};
var ZodCatch = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const newCtx = {
      ...ctx,
      common: {
        ...ctx.common,
        issues: []
      }
    };
    const result = this._def.innerType._parse({
      data: newCtx.data,
      path: newCtx.path,
      parent: {
        ...newCtx
      }
    });
    if (isAsync(result)) {
      return result.then((result2) => {
        return {
          status: "valid",
          value: result2.status === "valid" ? result2.value : this._def.catchValue({
            get error() {
              return new ZodError(newCtx.common.issues);
            },
            input: newCtx.data
          })
        };
      });
    } else {
      return {
        status: "valid",
        value: result.status === "valid" ? result.value : this._def.catchValue({
          get error() {
            return new ZodError(newCtx.common.issues);
          },
          input: newCtx.data
        })
      };
    }
  }
  removeCatch() {
    return this._def.innerType;
  }
};
ZodCatch.create = (type, params) => {
  return new ZodCatch({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodCatch,
    catchValue: typeof params.catch === "function" ? params.catch : () => params.catch,
    ...processCreateParams(params)
  });
};
var ZodNaN = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.nan) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.nan,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
};
ZodNaN.create = (params) => {
  return new ZodNaN({
    typeName: ZodFirstPartyTypeKind.ZodNaN,
    ...processCreateParams(params)
  });
};
var BRAND = /* @__PURE__ */ Symbol("zod_brand");
var ZodBranded = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const data = ctx.data;
    return this._def.type._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  unwrap() {
    return this._def.type;
  }
};
var ZodPipeline = class _ZodPipeline extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.common.async) {
      const handleAsync = async () => {
        const inResult = await this._def.in._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inResult.status === "aborted")
          return INVALID;
        if (inResult.status === "dirty") {
          status.dirty();
          return DIRTY(inResult.value);
        } else {
          return this._def.out._parseAsync({
            data: inResult.value,
            path: ctx.path,
            parent: ctx
          });
        }
      };
      return handleAsync();
    } else {
      const inResult = this._def.in._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
      if (inResult.status === "aborted")
        return INVALID;
      if (inResult.status === "dirty") {
        status.dirty();
        return {
          status: "dirty",
          value: inResult.value
        };
      } else {
        return this._def.out._parseSync({
          data: inResult.value,
          path: ctx.path,
          parent: ctx
        });
      }
    }
  }
  static create(a, b) {
    return new _ZodPipeline({
      in: a,
      out: b,
      typeName: ZodFirstPartyTypeKind.ZodPipeline
    });
  }
};
var ZodReadonly = class extends ZodType {
  _parse(input) {
    const result = this._def.innerType._parse(input);
    const freeze = (data) => {
      if (isValid(data)) {
        data.value = Object.freeze(data.value);
      }
      return data;
    };
    return isAsync(result) ? result.then((data) => freeze(data)) : freeze(result);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodReadonly.create = (type, params) => {
  return new ZodReadonly({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodReadonly,
    ...processCreateParams(params)
  });
};
function cleanParams(params, data) {
  const p = typeof params === "function" ? params(data) : typeof params === "string" ? { message: params } : params;
  const p2 = typeof p === "string" ? { message: p } : p;
  return p2;
}
function custom(check, _params = {}, fatal) {
  if (check)
    return ZodAny.create().superRefine((data, ctx) => {
      const r = check(data);
      if (r instanceof Promise) {
        return r.then((r2) => {
          if (!r2) {
            const params = cleanParams(_params, data);
            const _fatal = params.fatal ?? fatal ?? true;
            ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
          }
        });
      }
      if (!r) {
        const params = cleanParams(_params, data);
        const _fatal = params.fatal ?? fatal ?? true;
        ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
      }
      return;
    });
  return ZodAny.create();
}
var late = {
  object: ZodObject.lazycreate
};
var ZodFirstPartyTypeKind;
(function(ZodFirstPartyTypeKind2) {
  ZodFirstPartyTypeKind2["ZodString"] = "ZodString";
  ZodFirstPartyTypeKind2["ZodNumber"] = "ZodNumber";
  ZodFirstPartyTypeKind2["ZodNaN"] = "ZodNaN";
  ZodFirstPartyTypeKind2["ZodBigInt"] = "ZodBigInt";
  ZodFirstPartyTypeKind2["ZodBoolean"] = "ZodBoolean";
  ZodFirstPartyTypeKind2["ZodDate"] = "ZodDate";
  ZodFirstPartyTypeKind2["ZodSymbol"] = "ZodSymbol";
  ZodFirstPartyTypeKind2["ZodUndefined"] = "ZodUndefined";
  ZodFirstPartyTypeKind2["ZodNull"] = "ZodNull";
  ZodFirstPartyTypeKind2["ZodAny"] = "ZodAny";
  ZodFirstPartyTypeKind2["ZodUnknown"] = "ZodUnknown";
  ZodFirstPartyTypeKind2["ZodNever"] = "ZodNever";
  ZodFirstPartyTypeKind2["ZodVoid"] = "ZodVoid";
  ZodFirstPartyTypeKind2["ZodArray"] = "ZodArray";
  ZodFirstPartyTypeKind2["ZodObject"] = "ZodObject";
  ZodFirstPartyTypeKind2["ZodUnion"] = "ZodUnion";
  ZodFirstPartyTypeKind2["ZodDiscriminatedUnion"] = "ZodDiscriminatedUnion";
  ZodFirstPartyTypeKind2["ZodIntersection"] = "ZodIntersection";
  ZodFirstPartyTypeKind2["ZodTuple"] = "ZodTuple";
  ZodFirstPartyTypeKind2["ZodRecord"] = "ZodRecord";
  ZodFirstPartyTypeKind2["ZodMap"] = "ZodMap";
  ZodFirstPartyTypeKind2["ZodSet"] = "ZodSet";
  ZodFirstPartyTypeKind2["ZodFunction"] = "ZodFunction";
  ZodFirstPartyTypeKind2["ZodLazy"] = "ZodLazy";
  ZodFirstPartyTypeKind2["ZodLiteral"] = "ZodLiteral";
  ZodFirstPartyTypeKind2["ZodEnum"] = "ZodEnum";
  ZodFirstPartyTypeKind2["ZodEffects"] = "ZodEffects";
  ZodFirstPartyTypeKind2["ZodNativeEnum"] = "ZodNativeEnum";
  ZodFirstPartyTypeKind2["ZodOptional"] = "ZodOptional";
  ZodFirstPartyTypeKind2["ZodNullable"] = "ZodNullable";
  ZodFirstPartyTypeKind2["ZodDefault"] = "ZodDefault";
  ZodFirstPartyTypeKind2["ZodCatch"] = "ZodCatch";
  ZodFirstPartyTypeKind2["ZodPromise"] = "ZodPromise";
  ZodFirstPartyTypeKind2["ZodBranded"] = "ZodBranded";
  ZodFirstPartyTypeKind2["ZodPipeline"] = "ZodPipeline";
  ZodFirstPartyTypeKind2["ZodReadonly"] = "ZodReadonly";
})(ZodFirstPartyTypeKind || (ZodFirstPartyTypeKind = {}));
var instanceOfType = (cls, params = {
  message: `Input not instance of ${cls.name}`
}) => custom((data) => data instanceof cls, params);
var stringType = ZodString.create;
var numberType = ZodNumber.create;
var nanType = ZodNaN.create;
var bigIntType = ZodBigInt.create;
var booleanType = ZodBoolean.create;
var dateType = ZodDate.create;
var symbolType = ZodSymbol.create;
var undefinedType = ZodUndefined.create;
var nullType = ZodNull.create;
var anyType = ZodAny.create;
var unknownType = ZodUnknown.create;
var neverType = ZodNever.create;
var voidType = ZodVoid.create;
var arrayType = ZodArray.create;
var objectType = ZodObject.create;
var strictObjectType = ZodObject.strictCreate;
var unionType = ZodUnion.create;
var discriminatedUnionType = ZodDiscriminatedUnion.create;
var intersectionType = ZodIntersection.create;
var tupleType = ZodTuple.create;
var recordType = ZodRecord.create;
var mapType = ZodMap.create;
var setType = ZodSet.create;
var functionType = ZodFunction.create;
var lazyType = ZodLazy.create;
var literalType = ZodLiteral.create;
var enumType = ZodEnum.create;
var nativeEnumType = ZodNativeEnum.create;
var promiseType = ZodPromise.create;
var effectsType = ZodEffects.create;
var optionalType = ZodOptional.create;
var nullableType = ZodNullable.create;
var preprocessType = ZodEffects.createWithPreprocess;
var pipelineType = ZodPipeline.create;
var ostring = () => stringType().optional();
var onumber = () => numberType().optional();
var oboolean = () => booleanType().optional();
var coerce = {
  string: ((arg) => ZodString.create({ ...arg, coerce: true })),
  number: ((arg) => ZodNumber.create({ ...arg, coerce: true })),
  boolean: ((arg) => ZodBoolean.create({
    ...arg,
    coerce: true
  })),
  bigint: ((arg) => ZodBigInt.create({ ...arg, coerce: true })),
  date: ((arg) => ZodDate.create({ ...arg, coerce: true }))
};
var NEVER = INVALID;

// ../../node_modules/.pnpm/@paperclipai+shared@2026.722.0/node_modules/@paperclipai/shared/dist/constants.js
var COMPANY_STATUSES = ["active", "paused", "archived"];
var DEFAULT_COMPANY_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
var MAX_COMPANY_ATTACHMENT_MAX_BYTES = 1024 * 1024 * 1024;
var DEPLOYMENT_MODES = ["local_trusted", "authenticated"];
var DEPLOYMENT_EXPOSURES = ["private", "public"];
var BIND_MODES = ["loopback", "lan", "tailnet", "custom"];
var AUTH_BASE_URL_MODES = ["auto", "explicit"];
var AGENT_STATUSES = [
  "active",
  "paused",
  "idle",
  "running",
  "error",
  "pending_approval",
  "terminated"
];
var AGENT_ADAPTER_TYPES = [
  "process",
  "http",
  "claude_local",
  "codex_local",
  "cursor_cloud",
  "gemini_local",
  "grok_local",
  "hermes_gateway",
  "hermes_local",
  "opencode_local",
  "pi_local",
  "cursor",
  "openclaw_gateway"
];
var AGENT_ROLES = [
  "ceo",
  "cto",
  "cmo",
  "cfo",
  "security",
  "engineer",
  "designer",
  "pm",
  "qa",
  "devops",
  "researcher",
  "general"
];
var MODEL_PROFILE_KEYS = ["cheap"];
var AGENT_ICON_NAMES = [
  "bot",
  "cpu",
  "brain",
  "zap",
  "rocket",
  "code",
  "terminal",
  "shield",
  "eye",
  "search",
  "wrench",
  "hammer",
  "lightbulb",
  "sparkles",
  "star",
  "heart",
  "flame",
  "bug",
  "cog",
  "database",
  "globe",
  "lock",
  "mail",
  "message-square",
  "file-code",
  "git-branch",
  "package",
  "puzzle",
  "target",
  "wand",
  "atom",
  "circuit-board",
  "radar",
  "swords",
  "telescope",
  "microscope",
  "crown",
  "gem",
  "hexagon",
  "pentagon",
  "fingerprint"
];
var PROJECT_ICON_NAMES = [
  "folder",
  "rocket",
  "code",
  "terminal",
  "database",
  "globe",
  "package",
  "boxes",
  "box",
  "layers",
  "briefcase",
  "compass",
  "target",
  "flame",
  "zap",
  "star",
  "bug",
  "wrench",
  "hammer",
  "lightbulb",
  "sparkles",
  "shield",
  "lock",
  "search",
  "cog",
  "brain",
  "cpu",
  "git-branch",
  "file-code",
  "puzzle",
  "gem",
  "atom",
  "heart",
  "mail",
  "message-square",
  "crown",
  "radar",
  "telescope",
  "hexagon"
];
var ISSUE_STATUSES = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "blocked",
  "cancelled"
];
var INBOX_MINE_ISSUE_STATUSES = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "blocked",
  "done"
];
var INBOX_MINE_ISSUE_STATUS_FILTER = INBOX_MINE_ISSUE_STATUSES.join(",");
var ISSUE_PRIORITIES = ["critical", "high", "medium", "low"];
var ISSUE_WORK_MODES = ["standard", "ask", "planning", "skill_test"];
var ISSUE_HARNESS_KINDS = ["skill_test"];
var MAX_ISSUE_REQUEST_DEPTH = 1024;
var SUMMARY_SLOT_SCOPE_KINDS = ["project", "workspaces_overview", "project_workspace"];
var SUMMARY_SLOT_KEYS = ["header"];
var SUMMARY_SLOT_STATUSES = ["idle", "generating", "failed"];
var ISSUE_COMMENT_AUTHOR_TYPES = ["user", "agent", "system"];
var ISSUE_COMMENT_PRESENTATION_KINDS = ["message", "system_notice"];
var ISSUE_COMMENT_PRESENTATION_TONES = ["neutral", "info", "success", "warning", "danger"];
var ISSUE_COMMENT_METADATA_ROW_TYPES = [
  "text",
  "code",
  "key_value",
  "issue_link",
  "agent_link",
  "run_link"
];
function clampIssueRequestDepth(value) {
  if (typeof value !== "number" || !Number.isFinite(value))
    return 0;
  return Math.min(MAX_ISSUE_REQUEST_DEPTH, Math.max(0, Math.floor(value)));
}
var ISSUE_THREAD_INTERACTION_KINDS = [
  "suggest_tasks",
  "ask_user_questions",
  "request_confirmation",
  "request_checkbox_confirmation",
  "request_item_verdicts"
];
var REQUEST_CHECKBOX_CONFIRMATION_OPTION_LIMIT = 200;
var REQUEST_ITEM_VERDICTS_ITEM_LIMIT = REQUEST_CHECKBOX_CONFIRMATION_OPTION_LIMIT;
var ISSUE_THREAD_INTERACTION_STATUSES = [
  "pending",
  "accepted",
  "rejected",
  "answered",
  "cancelled",
  "expired",
  "failed"
];
var ISSUE_THREAD_INTERACTION_CONTINUATION_POLICIES = [
  "none",
  "wake_assignee",
  "wake_assignee_on_accept"
];
var ISSUE_WATCHDOG_DISCOVERY_KINDS = ["product_bug", "platform_bug"];
var ISSUE_SURFACE_VISIBILITIES = ["default", "plugin_operation"];
var ISSUE_RECOVERY_ACTION_KINDS = [
  "missing_disposition",
  "stranded_assigned_issue",
  "workspace_validation",
  "configuration_validation",
  "active_run_watchdog",
  "issue_graph_liveness"
];
var ISSUE_RECOVERY_ACTION_STATUSES = [
  "active",
  "escalated",
  "resolved",
  "cancelled"
];
var ISSUE_RECOVERY_ACTION_OWNER_TYPES = [
  "agent",
  "user",
  "board",
  "system"
];
var ISSUE_RECOVERY_ACTION_OUTCOMES = [
  "restored",
  "handed_back",
  "owner_completed",
  "delegated",
  "false_positive",
  "blocked",
  "escalated",
  "cancelled"
];
var ISSUE_TREE_CONTROL_MODES = ["pause", "resume", "cancel", "restore"];
var ISSUE_TREE_HOLD_RELEASE_POLICY_STRATEGIES = ["manual", "after_active_runs_finish"];
var ISSUE_CONTINUATION_SUMMARY_DOCUMENT_KEY = "continuation-summary";
var PIPELINE_CASE_BODY_DOCUMENT_KEY = "pipeline-case-body";
var SYSTEM_ISSUE_DOCUMENT_KEYS = [
  ISSUE_CONTINUATION_SUMMARY_DOCUMENT_KEY,
  PIPELINE_CASE_BODY_DOCUMENT_KEY
];
var SYSTEM_ISSUE_DOCUMENT_KEY_SET = new Set(SYSTEM_ISSUE_DOCUMENT_KEYS);
var DOCUMENT_ANNOTATION_THREAD_STATUSES = ["open", "resolved"];
var DOCUMENT_ANNOTATION_ANCHOR_STATES = ["active", "stale", "orphaned"];
var DOCUMENT_ANNOTATION_ANCHOR_CONFIDENCES = [
  "exact",
  "duplicate",
  "fuzzy",
  "ambiguous",
  "missing"
];
var EXTERNAL_OBJECT_STATUS_CATEGORIES = [
  "unknown",
  "open",
  "waiting",
  "running",
  "succeeded",
  "failed",
  "blocked",
  "closed",
  "archived",
  "auth_required",
  "unreachable"
];
var EXTERNAL_OBJECT_STATUS_TONES = [
  "neutral",
  "info",
  "success",
  "warning",
  "danger",
  "muted"
];
var EXTERNAL_OBJECT_LIVENESS_STATES = [
  "unknown",
  "fresh",
  "stale",
  "auth_required",
  "unreachable"
];
var EXTERNAL_OBJECT_MENTION_SOURCE_KINDS = [
  "title",
  "description",
  "comment",
  "document",
  "property",
  "plugin"
];
var EXTERNAL_OBJECT_MENTION_CONFIDENCES = ["exact", "likely", "possible"];
var ISSUE_EXECUTION_POLICY_MODES = ["normal", "auto"];
var ISSUE_EXECUTION_STAGE_TYPES = ["review", "approval"];
var ISSUE_MONITOR_SCHEDULED_BY = ["assignee", "board"];
var ISSUE_EXECUTION_MONITOR_KINDS = ["external_service"];
var ISSUE_EXECUTION_MONITOR_RECOVERY_POLICIES = [
  "wake_owner",
  "create_recovery_issue",
  "escalate_to_board"
];
var ISSUE_EXECUTION_STATE_STATUSES = ["idle", "pending", "changes_requested", "completed"];
var ISSUE_EXECUTION_MONITOR_STATE_STATUSES = ["scheduled", "triggered", "cleared"];
var ISSUE_EXECUTION_MONITOR_CLEAR_REASONS = [
  "manual",
  "triggered",
  "done",
  "cancelled",
  "invalid_status",
  "invalid_assignee",
  "dispatch_skipped",
  "timeout_exceeded",
  "max_attempts_exhausted"
];
var ISSUE_EXECUTION_DECISION_OUTCOMES = ["approved", "changes_requested"];
var GOAL_LEVELS = ["company", "team", "agent", "task"];
var GOAL_STATUSES = ["planned", "active", "achieved", "cancelled"];
var PROJECT_STATUSES = [
  "backlog",
  "planned",
  "in_progress",
  "completed",
  "cancelled"
];
var ENVIRONMENT_DRIVERS = ["local", "ssh", "sandbox", "plugin"];
var ENVIRONMENT_STATUSES = ["active", "archived"];
var ENVIRONMENT_LEASE_STATUSES = ["active", "released", "expired", "failed", "retained", "pending_cleanup"];
var ENVIRONMENT_LEASE_CLEANUP_STATUSES = ["pending", "success", "failed"];
var ENVIRONMENT_CUSTOM_IMAGE_TEMPLATE_KINDS = [
  "snapshot",
  "image",
  "provider_template",
  "unknown"
];
var ENVIRONMENT_CUSTOM_IMAGE_TEMPLATE_STATUSES = [
  "active",
  "superseded",
  "revoked",
  "failed"
];
var ENVIRONMENT_CUSTOM_IMAGE_SETUP_SESSION_STATUSES = [
  "starting",
  "waiting_for_user",
  "capturing",
  "promoted",
  "cancelled",
  "timed_out",
  "failed"
];
var ENVIRONMENT_CUSTOM_IMAGE_SETUP_CONNECTION_TYPES = [
  "ssh",
  "browser_terminal",
  "unknown"
];
var ROUTINE_STATUSES = ["active", "paused", "archived"];
var ROUTINE_CONCURRENCY_POLICIES = ["coalesce_if_active", "always_enqueue", "skip_if_active"];
var ROUTINE_CATCH_UP_POLICIES = ["skip_missed", "enqueue_missed_with_cap"];
var ROUTINE_TRIGGER_KINDS = ["schedule", "webhook", "api"];
var ROUTINE_TRIGGER_SIGNING_MODES = ["bearer", "hmac_sha256", "github_hmac", "none"];
var ROUTINE_VARIABLE_TYPES = ["text", "textarea", "number", "boolean", "select", "date"];
var APPROVAL_TYPES = [
  "hire_agent",
  "approve_ceo_strategy",
  "budget_override_required",
  "request_board_approval"
];
var SECRET_PROVIDERS = [
  "local_encrypted",
  "aws_secrets_manager",
  "gcp_secret_manager",
  "vault"
];
var SECRET_PROVIDER_CONFIG_STATUSES = [
  "ready",
  "warning",
  "coming_soon",
  "disabled"
];
var SECRET_STATUSES = ["active", "disabled", "archived", "deleted"];
var SECRET_MANAGED_MODES = ["paperclip_managed", "external_reference"];
var SECRET_BINDING_TARGET_TYPES = [
  "agent",
  "project",
  "environment",
  "routine",
  "plugin",
  "issue",
  "run",
  "tool_connection",
  "system"
];
var SECRET_PROJECTION_CLASSES = ["unclassified", "class_3_static_lease"];
var STORAGE_PROVIDERS = ["local_disk", "s3"];
var BILLING_TYPES = [
  "metered_api",
  "subscription_included",
  "subscription_overage",
  "credits",
  "fixed",
  "unknown"
];
var COST_STATUSES = ["reported", "unpriced"];
var FINANCE_EVENT_KINDS = [
  "inference_charge",
  "platform_fee",
  "credit_purchase",
  "credit_refund",
  "credit_expiry",
  "byok_fee",
  "gateway_overhead",
  "log_storage_charge",
  "logpush_charge",
  "provisioned_capacity_charge",
  "training_charge",
  "custom_model_import_charge",
  "custom_model_storage_charge",
  "manual_adjustment"
];
var FINANCE_DIRECTIONS = ["debit", "credit"];
var FINANCE_UNITS = [
  "input_token",
  "output_token",
  "cached_input_token",
  "request",
  "credit_usd",
  "credit_unit",
  "model_unit_minute",
  "model_unit_hour",
  "gb_month",
  "train_token",
  "unknown"
];
var BUDGET_SCOPE_TYPES = ["company", "agent", "project"];
var BUDGET_METRICS = ["billed_cents"];
var BUDGET_WINDOW_KINDS = ["calendar_month_utc", "lifetime"];
var BUDGET_INCIDENT_RESOLUTION_ACTIONS = [
  "keep_paused",
  "raise_budget_and_resume"
];
var HUMAN_COMPANY_MEMBERSHIP_ROLES = [
  "owner",
  "admin",
  "operator",
  "viewer"
];
var INVITE_JOIN_TYPES = ["human", "agent", "both"];
var JOIN_REQUEST_TYPES = ["human", "agent"];
var JOIN_REQUEST_STATUSES = ["pending_approval", "approved", "rejected"];
var PERMISSION_KEYS = [
  "agents:create",
  "agents:configure",
  "agents:suggest-changes",
  "skills:create",
  "skills:suggest-changes",
  "environments:manage",
  "tools:admin",
  "tools:manage_connections",
  "tools:manage_profiles",
  "tools:view_audit",
  "tools:use",
  "tools:manage_runtime",
  "inbox:manage",
  "users:invite",
  "users:manage_permissions",
  "tasks:assign",
  "tasks:assign_scope",
  "tasks:manage_active_checkouts",
  "pipelines:write",
  "joins:approve"
];
var TOOL_APPLICATION_TYPES = ["mcp_http", "mcp_stdio", "paperclip_plugin", "a2a"];
var TOOL_APPLICATION_STATUSES = ["draft", "active", "disabled", "archived"];
var TOOL_CONNECTION_KINDS = ["managed"];
var TOOL_CONNECTION_HEALTH_STATUSES = [
  "unknown",
  "healthy",
  "degraded",
  "failed",
  "unchecked",
  "ok",
  "error",
  "missing_secret"
];
var TOOL_CATALOG_ENTRY_KINDS = ["tool", "resource", "prompt"];
var TOOL_CATALOG_ENTRY_STATUSES = ["active", "disabled", "quarantined", "removed"];
var TOOL_RISK_LEVELS = ["low", "medium", "high", "critical", "read", "write", "destructive"];
var TOOL_PROFILE_STATUSES = ["draft", "active", "disabled", "archived"];
var TOOL_PROFILE_DEFAULT_ACTIONS = ["deny", "allow"];
var TOOL_PROFILE_ENTRY_SELECTOR_TYPES = [
  "application",
  "connection",
  "catalog_entry",
  "tool_name",
  "risk_level"
];
var TOOL_PROFILE_ENTRY_EFFECTS = ["include", "exclude"];
var TOOL_PROFILE_BINDING_TARGET_TYPES = ["company", "agent", "project", "routine", "issue", "gateway"];
var TOOL_MCP_GATEWAY_STATUSES = ["draft", "active", "disabled", "archived"];
var TOOL_MCP_GATEWAY_DEFAULT_PROFILE_MODES = [
  "gateway_only",
  "inherit_context_then_gateway",
  "gateway_then_context"
];
var TOOL_MCP_GATEWAY_CONTEXT_SCOPE_TYPES = [
  "none",
  "company",
  "project",
  "routine",
  "issue",
  "agent"
];
var TOOL_MCP_GATEWAY_TOKEN_SUBJECT_TYPES = ["gateway_client", "heartbeat_run", "board_user", "agent"];
var TOOL_MCP_GATEWAY_TOKEN_ACTIONS = ["tools/list", "tools/call"];
var CONNECTION_TOKEN_ISSUANCE_PATHS = ["exchange", "oauth_access", "static"];
var TOOL_POLICY_TYPES = [
  "allow",
  "block",
  "require_approval",
  "trust_rule",
  "rate_limit"
];
var TOOL_POLICY_DECISIONS = ["allow", "deny", "require_approval", "rate_limited", "defer_runtime"];
var TOOL_INVOCATION_STATUSES = [
  "pending",
  "authorized",
  "denied",
  "awaiting_approval",
  "executing",
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
  "rate_limited"
];
var TOOL_INVOCATION_APPROVAL_STATES = [
  "not_required",
  "required",
  "pending",
  "approved",
  "rejected",
  "expired"
];
var TOOL_ACTION_REQUEST_STATUSES = [
  "pending",
  "approved",
  "executing",
  "rejected",
  "expired",
  "cancelled",
  "executed",
  "failed"
];
var TOOL_AUDIT_EVENT_TYPES = [
  "discovery",
  "policy_decision",
  "invocation_created",
  "call_started",
  "call_completed",
  "call_failed",
  "call_denied",
  "approval_requested",
  "approval_resolved",
  "session_revoked",
  "trust_rule_created",
  "trust_rule_revoked",
  "trust_rule_used",
  "runtime_started",
  "runtime_stopped",
  "rate_limited"
];
var TOOL_AUDIT_OUTCOMES = ["pending", "success", "failure", "denied", "timeout", "cancelled"];
var TOOL_RUNTIME_KINDS = ["remote_session", "local_stdio"];
var TOOL_RUNTIME_SLOT_STATUSES = ["starting", "running", "idle", "stopped", "failed", "disabled", "error"];
var TOOL_RATE_LIMIT_WINDOW_KINDS = ["minute", "hour", "day", "month"];
var PLUGIN_STATUSES = [
  "installed",
  "ready",
  "disabled",
  "error",
  "upgrade_pending",
  "uninstalled"
];
var PLUGIN_CATEGORIES = [
  "connector",
  "workspace",
  "automation",
  "ui"
];
var PLUGIN_CAPABILITIES = [
  // Data Read
  "companies.read",
  "projects.read",
  "project.workspaces.read",
  "execution.workspaces.read",
  "issues.read",
  "issue.relations.read",
  "issue.subtree.read",
  "issue.comments.read",
  "issue.documents.read",
  "agents.read",
  "goals.read",
  "goals.create",
  "goals.update",
  "activity.read",
  "costs.read",
  "issues.orchestration.read",
  "access.members.read",
  "access.invites.read",
  "authorization.grants.read",
  "authorization.policies.read",
  "authorization.audit.read",
  "database.namespace.read",
  // Data Write
  "issues.create",
  "issues.update",
  "issue.relations.write",
  "issues.checkout",
  "issues.wakeup",
  "issue.comments.create",
  "issue.comments.create_human_attributed",
  "issue.interactions.create",
  "issue.documents.write",
  "projects.managed",
  "routines.managed",
  "skills.managed",
  "agents.pause",
  "agents.resume",
  "agents.invoke",
  "agents.managed",
  "access.members.write",
  "access.invites.write",
  "authorization.grants.write",
  "authorization.policies.write",
  "agent.sessions.create",
  "agent.sessions.list",
  "agent.sessions.send",
  "agent.sessions.close",
  "activity.log.write",
  "metrics.write",
  "telemetry.track",
  "database.namespace.migrate",
  "database.namespace.write",
  "external.objects.detect",
  "external.objects.read",
  "external.objects.write",
  "external.objects.refresh",
  // Plugin State
  "plugin.state.read",
  "plugin.state.write",
  // Runtime / Integration
  "events.subscribe",
  "events.emit",
  "jobs.schedule",
  "webhooks.receive",
  "api.routes.register",
  "http.outbound",
  "secrets.read-ref",
  "environment.drivers.register",
  "local.folders",
  // Agent Tools
  "agent.tools.register",
  // UI
  "instance.settings.register",
  "ui.sidebar.register",
  "ui.page.register",
  "ui.detailTab.register",
  "ui.dashboardWidget.register",
  "ui.commentAnnotation.register",
  "ui.action.register"
];
var PLUGIN_DATABASE_CORE_READ_TABLES = [
  "companies",
  "projects",
  "goals",
  "agents",
  "issues",
  "issue_documents",
  "issue_relations",
  "issue_comments",
  "heartbeat_runs",
  "cost_events",
  "approvals",
  "issue_approvals",
  "budget_incidents"
];
var PLUGIN_API_ROUTE_METHODS = ["GET", "POST", "PATCH", "DELETE"];
var PLUGIN_API_ROUTE_AUTH_MODES = ["board", "agent", "board-or-agent", "webhook"];
var PLUGIN_API_ROUTE_CHECKOUT_POLICIES = [
  "none",
  "required-for-agent-in-progress",
  "always-for-agent"
];
var PLUGIN_UI_SLOT_TYPES = [
  "page",
  "detailTab",
  "taskDetailView",
  "dashboardWidget",
  "sidebar",
  "routeSidebar",
  "sidebarPanel",
  "projectSidebarItem",
  "globalToolbarButton",
  "toolbarButton",
  "contextMenuItem",
  "commentAnnotation",
  "commentContextMenuItem",
  "settingsPage",
  "companySettingsPage"
];
var WORKSPACE_OVERVIEW_DEFAULT_LIMIT = 50;
var WORKSPACE_OVERVIEW_MAX_LIMIT = 100;
var PLUGIN_RESERVED_COMPANY_ROUTE_SEGMENTS = [
  "dashboard",
  "onboarding",
  "companies",
  "company",
  "settings",
  "plugins",
  "org",
  "agents",
  "projects",
  "issues",
  "goals",
  "approvals",
  "costs",
  "activity",
  "inbox",
  "workspaces",
  "design-guide",
  "tests"
];
var PLUGIN_RESERVED_COMPANY_SETTINGS_ROUTE_SEGMENTS = [
  "general",
  "environments",
  "access",
  "members",
  "invites",
  "secrets",
  "instance"
];
var PLUGIN_LAUNCHER_PLACEMENT_ZONES = [
  "page",
  "detailTab",
  "taskDetailView",
  "dashboardWidget",
  "sidebar",
  "sidebarPanel",
  "projectSidebarItem",
  "globalToolbarButton",
  "toolbarButton",
  "contextMenuItem",
  "commentAnnotation",
  "commentContextMenuItem",
  "settingsPage"
];
var PLUGIN_LAUNCHER_ACTIONS = [
  "navigate",
  "openModal",
  "openDrawer",
  "openPopover",
  "performAction",
  "deepLink"
];
var PLUGIN_LAUNCHER_BOUNDS = [
  "inline",
  "compact",
  "default",
  "wide",
  "full"
];
var PLUGIN_LAUNCHER_RENDER_ENVIRONMENTS = [
  "hostInline",
  "hostOverlay",
  "hostRoute",
  "external",
  "iframe"
];
var PLUGIN_UI_SLOT_ENTITY_TYPES = [
  "project",
  "issue",
  "agent",
  "goal",
  "run",
  "comment",
  "execution_workspace",
  "project_workspace"
];
var PLUGIN_STATE_SCOPE_KINDS = [
  "instance",
  "company",
  "project",
  "project_workspace",
  "agent",
  "issue",
  "goal",
  "run"
];

// ../../node_modules/.pnpm/@paperclipai+shared@2026.722.0/node_modules/@paperclipai/shared/dist/adapter-type.js
var agentAdapterTypeSchema = external_exports.string().trim().min(1).default("process").describe(`Known built-in adapters: ${AGENT_ADAPTER_TYPES.join(", ")}. External adapters may register additional non-empty string types at runtime.`);
var optionalAgentAdapterTypeSchema = external_exports.string().trim().min(1).optional();

// ../../node_modules/.pnpm/@paperclipai+shared@2026.722.0/node_modules/@paperclipai/shared/dist/frontmatter.js
var SKILL_FRONTMATTER_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
var skillMetadataValueSchema = external_exports.lazy(() => external_exports.union([
  external_exports.string(),
  external_exports.number(),
  external_exports.boolean(),
  external_exports.null(),
  external_exports.array(skillMetadataValueSchema),
  external_exports.record(skillMetadataValueSchema)
]));
var skillFrontmatterSchema = external_exports.object({
  name: external_exports.string().regex(SKILL_FRONTMATTER_SLUG_RE, "Expected a lowercase URL slug."),
  description: external_exports.string().min(1),
  "allowed-tools": external_exports.array(external_exports.string()).optional(),
  metadata: external_exports.record(skillMetadataValueSchema).optional()
}).passthrough();

// ../../node_modules/.pnpm/@paperclipai+shared@2026.722.0/node_modules/@paperclipai/shared/dist/trust-policy.js
var TRUST_PRESETS = ["standard", "low_trust_review"];
var LOW_TRUST_REVIEW_PRESET = "low_trust_review";
var LOW_TRUST_REVIEW_PRESET_VERSION = 1;
var LOW_TRUST_REVIEW_RAW_OUTPUT_DISPOSITION = "quarantine";

// ../../node_modules/.pnpm/@paperclipai+shared@2026.722.0/node_modules/@paperclipai/shared/dist/app-definitions/zapier.json
var zapier_default = {
  schemaVersion: 1,
  slug: "zapier",
  name: "Zapier",
  description: "Reach thousands of apps through your Zapier account.",
  categories: [
    "productivity"
  ],
  featured: true,
  branding: {
    logoUrl: "https://www.google.com/s2/favicons?domain=zapier.com&sz=128"
  },
  urlPatterns: [
    "https://mcp.zapier.com/*"
  ],
  methods: [
    {
      key: "mcp-key",
      transport: "mcp_remote",
      auth: "api_key",
      ownershipModes: [
        "customer"
      ],
      whenToUse: "Use the provider-hosted connection for the quickest setup.",
      defaults: {
        serverUrl: "https://mcp.zapier.com/api/mcp"
      },
      guidanceMd: "Create a Zapier MCP connection, then paste its token here.",
      riskTier: "S3",
      credentialFields: [
        {
          key: "authorization",
          label: "Zapier MCP token",
          type: "password",
          required: true,
          placeholder: "Paste your Zapier token",
          secret: true
        }
      ],
      keyPlacement: {
        location: "header",
        name: "Authorization",
        prefix: "Bearer "
      }
    }
  ]
};

// ../../node_modules/.pnpm/@paperclipai+shared@2026.722.0/node_modules/@paperclipai/shared/dist/app-definitions/github.json
var github_default = {
  schemaVersion: 1,
  slug: "github",
  name: "GitHub",
  description: "Read code and pull requests, and coordinate repository work.",
  categories: [
    "developer"
  ],
  featured: true,
  branding: {
    logoUrl: "https://www.google.com/s2/favicons?domain=github.com&sz=128"
  },
  urlPatterns: [
    "https://api.githubcopilot.com/mcp/*"
  ],
  methods: [
    {
      key: "mcp-key",
      transport: "mcp_remote",
      auth: "api_key",
      ownershipModes: [
        "customer"
      ],
      whenToUse: "Use the provider-hosted connection for the quickest setup.",
      defaults: {
        serverUrl: "https://api.githubcopilot.com/mcp/"
      },
      guidanceMd: "Create a fine-grained token limited to the repositories agents should use.",
      riskTier: "S3",
      credentialFields: [
        {
          key: "authorization",
          label: "GitHub token",
          type: "password",
          required: true,
          placeholder: "github_pat_...",
          secret: true
        }
      ],
      keyPlacement: {
        location: "header",
        name: "Authorization",
        prefix: "Bearer "
      },
      requiredResourceFilters: [
        "organization",
        "repository"
      ]
    }
  ]
};

// ../../node_modules/.pnpm/@paperclipai+shared@2026.722.0/node_modules/@paperclipai/shared/dist/app-definitions/slack.json
var slack_default = {
  schemaVersion: 1,
  slug: "slack",
  name: "Slack",
  description: "Search channels and coordinate team communication.",
  categories: [
    "communication"
  ],
  featured: true,
  branding: {
    logoUrl: "https://www.google.com/s2/favicons?domain=slack.com&sz=128"
  },
  urlPatterns: [
    "https://mcp.slack.com/*"
  ],
  methods: [
    {
      key: "mcp-oauth",
      transport: "mcp_remote",
      auth: "oauth",
      ownershipModes: [
        "customer",
        "dcr"
      ],
      whenToUse: "Use the provider-hosted connection for the quickest setup.",
      defaults: {
        serverUrl: "https://mcp.slack.com/mcp",
        authorizationEndpoint: "https://slack.com/oauth/v2/authorize",
        tokenEndpoint: "https://slack.com/api/oauth.v2.access",
        scopesHint: [
          "channels:read",
          "chat:write",
          "search:read"
        ]
      },
      guidanceMd: "Connect a Slack workspace and limit access to the channels agents need.",
      riskTier: "S3",
      requiredResourceFilters: [
        "workspace",
        "channel"
      ]
    }
  ]
};

// ../../node_modules/.pnpm/@paperclipai+shared@2026.722.0/node_modules/@paperclipai/shared/dist/app-definitions/notion.json
var notion_default = {
  schemaVersion: 1,
  slug: "notion",
  name: "Notion",
  description: "Read and update pages in your Notion workspace.",
  categories: [
    "content"
  ],
  featured: true,
  branding: {
    logoUrl: "https://www.google.com/s2/favicons?domain=notion.so&sz=128"
  },
  urlPatterns: [
    "https://mcp.notion.com/*"
  ],
  methods: [
    {
      key: "mcp-oauth",
      transport: "mcp_remote",
      auth: "oauth",
      ownershipModes: [
        "customer",
        "dcr"
      ],
      whenToUse: "Use the provider-hosted connection for the quickest setup.",
      defaults: {
        serverUrl: "https://mcp.notion.com/mcp",
        authorizationEndpoint: "https://api.notion.com/v1/oauth/authorize",
        tokenEndpoint: "https://api.notion.com/v1/oauth/token",
        scopesHint: [
          "read_content",
          "update_content"
        ]
      },
      guidanceMd: "Connect Notion for workspace content. Share only the pages and databases agents should use.",
      riskTier: "S3",
      requiredResourceFilters: [
        "workspace",
        "page",
        "database"
      ]
    }
  ]
};

// ../../node_modules/.pnpm/@paperclipai+shared@2026.722.0/node_modules/@paperclipai/shared/dist/app-definitions/linear.json
var linear_default = {
  schemaVersion: 1,
  slug: "linear",
  name: "Linear",
  description: "Create, update, and read Linear issues.",
  categories: [
    "productivity"
  ],
  featured: true,
  branding: {
    logoUrl: "https://www.google.com/s2/favicons?domain=linear.app&sz=128"
  },
  urlPatterns: [
    "https://mcp.linear.app/*"
  ],
  methods: [
    {
      key: "mcp-oauth",
      transport: "mcp_remote",
      auth: "oauth",
      ownershipModes: [
        "customer",
        "dcr"
      ],
      whenToUse: "Use the provider-hosted connection for the quickest setup.",
      defaults: {
        serverUrl: "https://mcp.linear.app/mcp",
        authorizationEndpoint: "https://linear.app/oauth/authorize",
        tokenEndpoint: "https://api.linear.app/oauth/token",
        scopesHint: [
          "read",
          "write"
        ]
      },
      guidanceMd: "Register a Linear OAuth app and add Paperclip's redirect URI before connecting.",
      riskTier: "S2",
      requiredResourceFilters: [
        "workspace",
        "team",
        "project"
      ]
    }
  ]
};

// ../../node_modules/.pnpm/@paperclipai+shared@2026.722.0/node_modules/@paperclipai/shared/dist/app-definitions/google-sheets.json
var google_sheets_default = {
  schemaVersion: 1,
  slug: "google-sheets",
  name: "Google Sheets",
  description: "Read and update selected spreadsheets.",
  categories: [
    "data"
  ],
  featured: false,
  branding: {
    logoUrl: "https://www.google.com/s2/favicons?domain=sheets.google.com&sz=128"
  },
  urlPatterns: [
    "https://docs.google.com/spreadsheets/*",
    "https://sheets.google.com/*"
  ],
  methods: [
    {
      key: "local",
      transport: "local_stdio",
      auth: "none",
      ownershipModes: [
        "customer"
      ],
      whenToUse: "Use credentials from your provider account.",
      defaults: {
        templateKey: "paperclip.google-sheets"
      },
      guidanceMd: "Share each spreadsheet with the Paperclip robot email, then paste the sheet links.",
      riskTier: "S3",
      requiredResourceFilters: [
        "spreadsheet"
      ]
    }
  ]
};

// ../../node_modules/.pnpm/@paperclipai+shared@2026.722.0/node_modules/@paperclipai/shared/dist/app-definitions/context7.json
var context7_default = {
  schemaVersion: 1,
  slug: "context7",
  name: "Context7",
  description: "Look up current documentation for software libraries.",
  categories: [
    "developer"
  ],
  featured: false,
  branding: {
    logoUrl: "https://www.google.com/s2/favicons?domain=context7.com&sz=128"
  },
  urlPatterns: [
    "https://mcp.context7.com/*"
  ],
  methods: [
    {
      key: "mcp",
      transport: "mcp_remote",
      auth: "none",
      ownershipModes: [
        "customer"
      ],
      whenToUse: "Use the provider-hosted connection for the quickest setup.",
      defaults: {
        serverUrl: "https://mcp.context7.com/mcp"
      },
      guidanceMd: "Connect Context7 to give agents current library documentation.",
      riskTier: "S1"
    }
  ]
};

// ../../node_modules/.pnpm/@paperclipai+shared@2026.722.0/node_modules/@paperclipai/shared/dist/app-definitions/oauth-generic.json
var oauth_generic_default = {
  schemaVersion: 1,
  slug: "oauth-generic",
  name: "OAuth app",
  description: "Connect a provider using your own OAuth client.",
  categories: [
    "other"
  ],
  featured: false,
  branding: {
    logoUrl: "https://www.google.com/s2/favicons?domain=oauth.net&sz=128"
  },
  urlPatterns: [],
  methods: [
    {
      key: "oauth",
      transport: "rest_api",
      auth: "oauth",
      ownershipModes: [
        "customer",
        "dcr"
      ],
      whenToUse: "Use credentials from your provider account.",
      defaults: {},
      guidanceMd: "Register an OAuth client with the provider and add Paperclip's redirect URI.",
      riskTier: "S3",
      credentialFields: [
        {
          key: "clientId",
          label: "Client ID",
          type: "text",
          required: true,
          placeholder: "Paste the client ID",
          secret: false
        },
        {
          key: "clientSecret",
          label: "Client secret",
          type: "password",
          required: true,
          placeholder: "Paste the client secret",
          secret: true
        }
      ]
    }
  ]
};

// ../../node_modules/.pnpm/@paperclipai+shared@2026.722.0/node_modules/@paperclipai/shared/dist/app-definitions/api-key-generic.json
var api_key_generic_default = {
  schemaVersion: 1,
  slug: "api-key-generic",
  name: "API key app",
  description: "Connect an API using a key from your provider.",
  categories: [
    "other"
  ],
  featured: false,
  branding: {
    logoUrl: "https://www.google.com/s2/favicons?domain=openapis.org&sz=128"
  },
  urlPatterns: [],
  methods: [
    {
      key: "api-key",
      transport: "rest_api",
      auth: "api_key",
      ownershipModes: [
        "customer"
      ],
      whenToUse: "Use credentials from your provider account.",
      defaults: {},
      guidanceMd: "Create a restricted API key and paste it here.",
      riskTier: "S3",
      credentialFields: [
        {
          key: "apiKey",
          label: "API key",
          type: "password",
          required: true,
          placeholder: "Paste the API key",
          secret: true
        }
      ],
      keyPlacement: {
        location: "header",
        name: "Authorization",
        prefix: "Bearer "
      }
    }
  ]
};

// ../../node_modules/.pnpm/@paperclipai+shared@2026.722.0/node_modules/@paperclipai/shared/dist/app-definitions/sentry.json
var sentry_default = {
  schemaVersion: 1,
  slug: "sentry",
  name: "Sentry",
  description: "Investigate errors, releases, and production issues.",
  categories: [
    "developer"
  ],
  featured: false,
  branding: {
    logoUrl: "https://www.google.com/s2/favicons?domain=sentry.io&sz=128"
  },
  urlPatterns: [
    "https://mcp.sentry.dev/*"
  ],
  methods: [
    {
      key: "mcp-oauth",
      transport: "mcp_remote",
      auth: "oauth",
      ownershipModes: [
        "customer",
        "dcr"
      ],
      whenToUse: "Use the provider-hosted connection for the quickest setup.",
      defaults: {
        serverUrl: "https://mcp.sentry.dev/mcp",
        discoveryUrl: "https://sentry.io/.well-known/oauth-authorization-server"
      },
      guidanceMd: "Connect the Sentry organization and projects agents need for incident work.",
      riskTier: "S2",
      requiredResourceFilters: [
        "organization",
        "project",
        "environment"
      ]
    }
  ]
};

// ../../node_modules/.pnpm/@paperclipai+shared@2026.722.0/node_modules/@paperclipai/shared/dist/app-definitions/vercel.json
var vercel_default = {
  schemaVersion: 1,
  slug: "vercel",
  name: "Vercel",
  description: "Inspect projects, deployments, and runtime logs.",
  categories: [
    "developer"
  ],
  featured: false,
  branding: {
    logoUrl: "https://www.google.com/s2/favicons?domain=vercel.com&sz=128"
  },
  urlPatterns: [
    "https://mcp.vercel.com/*"
  ],
  methods: [
    {
      key: "mcp-oauth",
      transport: "mcp_remote",
      auth: "oauth",
      ownershipModes: [
        "customer",
        "dcr"
      ],
      whenToUse: "Use the provider-hosted connection for the quickest setup.",
      defaults: {
        serverUrl: "https://mcp.vercel.com/mcp"
      },
      guidanceMd: "Connect the Vercel team and projects agents should operate.",
      riskTier: "S3",
      requiredResourceFilters: [
        "team",
        "project",
        "environment"
      ]
    }
  ]
};

// ../../node_modules/.pnpm/@paperclipai+shared@2026.722.0/node_modules/@paperclipai/shared/dist/app-definitions/anthropic.json
var anthropic_default = {
  schemaVersion: 1,
  slug: "anthropic",
  name: "Anthropic",
  description: "Use Anthropic APIs with a restricted key.",
  categories: [
    "ai"
  ],
  featured: false,
  branding: {
    logoUrl: "https://www.google.com/s2/favicons?domain=anthropic.com&sz=128"
  },
  urlPatterns: [
    "https://api.anthropic.com/*"
  ],
  methods: [
    {
      key: "api-key",
      transport: "rest_api",
      auth: "api_key",
      ownershipModes: [
        "customer"
      ],
      whenToUse: "Use credentials from your provider account.",
      defaults: {
        serviceHost: "api.anthropic.com"
      },
      guidanceMd: "Create a key in the Anthropic Console and rotate it if it has been exposed.",
      riskTier: "S3",
      credentialFields: [
        {
          key: "apiKey",
          label: "API key",
          type: "password",
          required: true,
          placeholder: "sk-ant-api03-...",
          secret: true
        }
      ],
      keyPlacement: {
        location: "header",
        name: "x-api-key"
      }
    }
  ]
};

// ../../node_modules/.pnpm/@paperclipai+shared@2026.722.0/node_modules/@paperclipai/shared/dist/app-definitions.generated.js
var APP_DEFINITIONS = [zapier_default, github_default, slack_default, notion_default, linear_default, google_sheets_default, context7_default, oauth_generic_default, api_key_generic_default, sentry_default, vercel_default, anthropic_default];

// ../../node_modules/.pnpm/@paperclipai+shared@2026.722.0/node_modules/@paperclipai/shared/dist/app-definitions.js
var CONNECTABLE_APP_SLUGS = /* @__PURE__ */ new Set([
  "zapier",
  "github",
  "slack",
  "notion",
  "linear",
  "google-sheets",
  "context7"
]);
var CONNECTABLE_APP_DEFINITIONS = APP_DEFINITIONS.filter((app) => CONNECTABLE_APP_SLUGS.has(app.slug));

// ../../node_modules/.pnpm/@paperclipai+shared@2026.722.0/node_modules/@paperclipai/shared/dist/validators/text.js
function normalizeEscapedLineBreaks(value) {
  return value.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n").replace(/\\r/g, "\n");
}
var multilineTextSchema = external_exports.string().transform(normalizeEscapedLineBreaks);

// ../../node_modules/.pnpm/@paperclipai+shared@2026.722.0/node_modules/@paperclipai/shared/dist/validators/trust-policy.js
var trustPresetSchema = external_exports.enum(TRUST_PRESETS);
var lowTrustOutputPromotionTargetSchema = external_exports.object({
  type: external_exports.literal("issue"),
  issueId: external_exports.string().uuid()
}).strict();
var lowTrustBoundarySchema = external_exports.object({
  mode: external_exports.literal(LOW_TRUST_REVIEW_PRESET),
  companyId: external_exports.string().uuid().optional(),
  projectIds: external_exports.array(external_exports.string().uuid()).optional(),
  rootIssueId: external_exports.string().uuid().optional(),
  issueIds: external_exports.array(external_exports.string().uuid()).optional(),
  allowedAgentIds: external_exports.array(external_exports.string().uuid()).optional(),
  allowedSecretBindingIds: external_exports.array(external_exports.string().uuid()).optional(),
  allowedToolClasses: external_exports.array(external_exports.string().trim().min(1)).optional(),
  outputPromotionTarget: lowTrustOutputPromotionTargetSchema.optional()
}).strict();
var lowTrustReviewPresetPolicySchema = external_exports.object({
  id: external_exports.literal(LOW_TRUST_REVIEW_PRESET),
  version: external_exports.literal(LOW_TRUST_REVIEW_PRESET_VERSION),
  rawOutputDisposition: external_exports.literal(LOW_TRUST_REVIEW_RAW_OUTPUT_DISPOSITION)
}).strict();
var trustAuthorizationPolicySchema = external_exports.object({
  trustPreset: trustPresetSchema.optional(),
  reviewPreset: lowTrustReviewPresetPolicySchema.optional(),
  trustBoundary: lowTrustBoundarySchema.optional()
}).catchall(external_exports.unknown());
var sourceTrustArtifactKindSchema = external_exports.enum(["issue", "comment", "document", "work_product"]);
var sourceTrustMetadataSchema = external_exports.object({
  preset: trustPresetSchema,
  disposition: external_exports.enum(["quarantined", "promoted"]),
  sourceIssueId: external_exports.string().uuid().nullable().optional(),
  sourceRunId: external_exports.string().uuid().nullable().optional(),
  sourceAgentId: external_exports.string().uuid().nullable().optional(),
  promotedFrom: external_exports.object({
    artifactKind: sourceTrustArtifactKindSchema,
    artifactId: external_exports.string().uuid(),
    issueId: external_exports.string().uuid().nullable().optional()
  }).strict().nullable().optional(),
  promotedByActorType: external_exports.enum(["agent", "user", "system"]).nullable().optional(),
  promotedByActorId: external_exports.string().trim().min(1).nullable().optional(),
  promotedAt: external_exports.string().datetime({ offset: true }).nullable().optional()
}).strict();

// ../../node_modules/.pnpm/@paperclipai+shared@2026.722.0/node_modules/@paperclipai/shared/dist/validators/issue.js
var issueBlockedInboxStateSchema = external_exports.enum([
  "needs_attention",
  "awaiting_decision",
  "external_wait",
  "recovery_open",
  "missing_disposition"
]);
var issueBlockedInboxSeveritySchema = external_exports.enum(["critical", "high", "medium", "low"]);
var issueBlockedInboxReasonSchema = external_exports.enum([
  "blocked_by_unassigned_issue",
  "blocked_by_assigned_backlog_issue",
  "blocked_by_uninvokable_assignee",
  "blocked_by_cancelled_issue",
  "blocked_chain_stalled",
  "invalid_review_participant",
  "in_review_without_action_path",
  "missing_successful_run_disposition",
  "pending_board_decision",
  "pending_user_decision",
  "external_owner_action",
  "open_recovery_issue"
]);
var issueBlockedInboxIssueRefSchema = external_exports.object({
  id: external_exports.string().uuid(),
  identifier: external_exports.string().nullable(),
  title: external_exports.string(),
  status: external_exports.enum(ISSUE_STATUSES),
  priority: external_exports.enum(ISSUE_PRIORITIES),
  assigneeAgentId: external_exports.string().uuid().nullable(),
  assigneeUserId: external_exports.string().nullable()
}).strict();
var issueBlockedInboxAttentionSchema = external_exports.object({
  kind: external_exports.literal("blocked"),
  state: issueBlockedInboxStateSchema,
  reason: issueBlockedInboxReasonSchema,
  severity: issueBlockedInboxSeveritySchema,
  stoppedSinceAt: external_exports.string().datetime().nullable(),
  owner: external_exports.object({
    type: external_exports.enum(["agent", "user", "board", "external", "unknown"]),
    agentId: external_exports.string().uuid().nullable(),
    userId: external_exports.string().nullable(),
    label: external_exports.string().nullable()
  }).strict(),
  action: external_exports.object({
    label: external_exports.string().trim().min(1),
    detail: external_exports.string().nullable()
  }).strict(),
  sourceIssue: issueBlockedInboxIssueRefSchema.nullable(),
  leafIssue: issueBlockedInboxIssueRefSchema.nullable(),
  recoveryIssue: issueBlockedInboxIssueRefSchema.nullable(),
  approvalId: external_exports.string().uuid().nullable(),
  interactionId: external_exports.string().uuid().nullable(),
  sampleIssueIdentifier: external_exports.string().nullable(),
  redaction: external_exports.object({
    externalDetailsRedacted: external_exports.boolean(),
    secretFieldsOmitted: external_exports.literal(true)
  }).strict()
}).strict();
var ISSUE_EXECUTION_WORKSPACE_PREFERENCES = [
  "inherit",
  "shared_workspace",
  "isolated_workspace",
  "operator_branch",
  "reuse_existing",
  "agent_default"
];
var executionWorkspaceStrategySchema = external_exports.object({
  type: external_exports.enum(["project_primary", "git_worktree", "adapter_managed", "cloud_sandbox"]).optional(),
  baseRef: external_exports.string().optional().nullable(),
  branchTemplate: external_exports.string().optional().nullable(),
  worktreeParentDir: external_exports.string().optional().nullable(),
  provisionCommand: external_exports.string().optional().nullable(),
  teardownCommand: external_exports.string().optional().nullable()
}).strict();
var issueExecutionWorkspaceSettingsSchema = external_exports.object({
  mode: external_exports.enum(ISSUE_EXECUTION_WORKSPACE_PREFERENCES).optional(),
  environmentId: external_exports.string().uuid().optional().nullable(),
  workspaceStrategy: executionWorkspaceStrategySchema.optional().nullable(),
  workspaceRuntime: external_exports.record(external_exports.string(), external_exports.unknown()).optional().nullable()
}).strict();
var issueAssigneeAdapterOverridesSchema = external_exports.object({
  modelProfile: external_exports.enum(MODEL_PROFILE_KEYS).optional(),
  adapterConfig: external_exports.record(external_exports.string(), external_exports.unknown()).optional(),
  useProjectWorkspace: external_exports.boolean().optional()
}).strict();
var issueExecutionStagePrincipalBaseSchema = external_exports.object({
  type: external_exports.enum(["agent", "user"]),
  agentId: external_exports.string().uuid().optional().nullable(),
  userId: external_exports.string().optional().nullable()
});
var issueExecutionStagePrincipalSchema = issueExecutionStagePrincipalBaseSchema.superRefine((value, ctx) => {
  if (value.type === "agent") {
    if (!value.agentId) {
      ctx.addIssue({ code: external_exports.ZodIssueCode.custom, message: "Agent participants require agentId", path: ["agentId"] });
    }
    if (value.userId) {
      ctx.addIssue({ code: external_exports.ZodIssueCode.custom, message: "Agent participants cannot set userId", path: ["userId"] });
    }
    return;
  }
  if (!value.userId) {
    ctx.addIssue({ code: external_exports.ZodIssueCode.custom, message: "User participants require userId", path: ["userId"] });
  }
  if (value.agentId) {
    ctx.addIssue({ code: external_exports.ZodIssueCode.custom, message: "User participants cannot set agentId", path: ["agentId"] });
  }
});
var issueExecutionStageParticipantSchema = issueExecutionStagePrincipalBaseSchema.extend({
  id: external_exports.string().uuid().optional()
}).superRefine((value, ctx) => {
  if (value.type === "agent") {
    if (!value.agentId) {
      ctx.addIssue({ code: external_exports.ZodIssueCode.custom, message: "Agent participants require agentId", path: ["agentId"] });
    }
    if (value.userId) {
      ctx.addIssue({ code: external_exports.ZodIssueCode.custom, message: "Agent participants cannot set userId", path: ["userId"] });
    }
    return;
  }
  if (!value.userId) {
    ctx.addIssue({ code: external_exports.ZodIssueCode.custom, message: "User participants require userId", path: ["userId"] });
  }
  if (value.agentId) {
    ctx.addIssue({ code: external_exports.ZodIssueCode.custom, message: "User participants cannot set agentId", path: ["agentId"] });
  }
});
var issueExecutionStageSchema = external_exports.object({
  id: external_exports.string().uuid().optional(),
  type: external_exports.enum(ISSUE_EXECUTION_STAGE_TYPES),
  approvalsNeeded: external_exports.literal(1).optional().default(1),
  participants: external_exports.array(issueExecutionStageParticipantSchema).default([])
});
var issueExecutionMonitorPolicySchema = external_exports.object({
  nextCheckAt: external_exports.string().datetime(),
  notes: external_exports.string().max(500).optional().nullable().default(null),
  scheduledBy: external_exports.enum(ISSUE_MONITOR_SCHEDULED_BY).optional().default("assignee"),
  kind: external_exports.enum(ISSUE_EXECUTION_MONITOR_KINDS).optional().nullable().default(null),
  serviceName: external_exports.string().trim().min(1).max(120).optional().nullable().default(null),
  externalRef: external_exports.string().trim().min(1).max(500).optional().nullable().default(null),
  timeoutAt: external_exports.string().datetime().optional().nullable().default(null),
  maxAttempts: external_exports.number().int().positive().max(100).optional().nullable().default(null),
  recoveryPolicy: external_exports.enum(ISSUE_EXECUTION_MONITOR_RECOVERY_POLICIES).optional().nullable().default(null)
});
var issueExecutionPolicySchema = external_exports.object({
  mode: external_exports.enum(ISSUE_EXECUTION_POLICY_MODES).optional().default("normal"),
  commentRequired: external_exports.boolean().optional().default(true),
  stages: external_exports.array(issueExecutionStageSchema).default([]),
  monitor: issueExecutionMonitorPolicySchema.optional().nullable(),
  reviewPreset: lowTrustReviewPresetPolicySchema.optional(),
  authorizationPolicy: trustAuthorizationPolicySchema.optional()
});
var issueExecutionMonitorStateSchema = external_exports.object({
  status: external_exports.enum(ISSUE_EXECUTION_MONITOR_STATE_STATUSES),
  nextCheckAt: external_exports.string().datetime().nullable(),
  lastTriggeredAt: external_exports.string().datetime().nullable(),
  attemptCount: external_exports.number().int().nonnegative().default(0),
  notes: external_exports.string().max(500).nullable(),
  scheduledBy: external_exports.enum(ISSUE_MONITOR_SCHEDULED_BY).nullable(),
  kind: external_exports.enum(ISSUE_EXECUTION_MONITOR_KINDS).nullable().optional().default(null),
  serviceName: external_exports.string().trim().min(1).max(120).nullable().optional().default(null),
  externalRef: external_exports.string().trim().min(1).max(500).nullable().optional().default(null),
  timeoutAt: external_exports.string().datetime().nullable().optional().default(null),
  maxAttempts: external_exports.number().int().positive().max(100).nullable().optional().default(null),
  recoveryPolicy: external_exports.enum(ISSUE_EXECUTION_MONITOR_RECOVERY_POLICIES).nullable().optional().default(null),
  clearedAt: external_exports.string().datetime().nullable(),
  clearReason: external_exports.enum(ISSUE_EXECUTION_MONITOR_CLEAR_REASONS).nullable()
});
var issueReviewRequestSchema = external_exports.object({
  instructions: external_exports.string().trim().min(1).max(2e4)
}).strict();
var issueExecutionStateSchema = external_exports.object({
  status: external_exports.enum(ISSUE_EXECUTION_STATE_STATUSES),
  currentStageId: external_exports.string().uuid().nullable(),
  currentStageIndex: external_exports.number().int().nonnegative().nullable(),
  currentStageType: external_exports.enum(ISSUE_EXECUTION_STAGE_TYPES).nullable(),
  currentParticipant: issueExecutionStagePrincipalSchema.nullable(),
  returnAssignee: issueExecutionStagePrincipalSchema.nullable(),
  reviewRequest: issueReviewRequestSchema.nullable().optional().default(null),
  completedStageIds: external_exports.array(external_exports.string().uuid()).default([]),
  lastDecisionId: external_exports.string().uuid().nullable(),
  lastDecisionOutcome: external_exports.enum(ISSUE_EXECUTION_DECISION_OUTCOMES).nullable(),
  monitor: issueExecutionMonitorStateSchema.optional().nullable()
});
var issueRecoveryActionReadModelSchema = external_exports.object({
  id: external_exports.string().uuid(),
  companyId: external_exports.string().uuid(),
  sourceIssueId: external_exports.string().uuid(),
  recoveryIssueId: external_exports.string().uuid().nullable(),
  kind: external_exports.enum(ISSUE_RECOVERY_ACTION_KINDS),
  status: external_exports.enum(ISSUE_RECOVERY_ACTION_STATUSES),
  ownerType: external_exports.enum(ISSUE_RECOVERY_ACTION_OWNER_TYPES),
  ownerAgentId: external_exports.string().uuid().nullable(),
  ownerUserId: external_exports.string().nullable(),
  previousOwnerAgentId: external_exports.string().uuid().nullable(),
  returnOwnerAgentId: external_exports.string().uuid().nullable(),
  cause: external_exports.string().min(1),
  fingerprint: external_exports.string().min(1),
  evidence: external_exports.record(external_exports.string(), external_exports.unknown()),
  nextAction: external_exports.string().min(1),
  wakePolicy: external_exports.record(external_exports.string(), external_exports.unknown()).nullable(),
  monitorPolicy: external_exports.record(external_exports.string(), external_exports.unknown()).nullable(),
  attemptCount: external_exports.number().int().nonnegative(),
  maxAttempts: external_exports.number().int().positive().nullable(),
  timeoutAt: external_exports.union([external_exports.date(), external_exports.string().datetime()]).nullable(),
  lastAttemptAt: external_exports.union([external_exports.date(), external_exports.string().datetime()]).nullable(),
  outcome: external_exports.enum(ISSUE_RECOVERY_ACTION_OUTCOMES).nullable(),
  resolutionNote: external_exports.string().nullable(),
  resolvedAt: external_exports.union([external_exports.date(), external_exports.string().datetime()]).nullable(),
  createdAt: external_exports.union([external_exports.date(), external_exports.string().datetime()]),
  updatedAt: external_exports.union([external_exports.date(), external_exports.string().datetime()])
});
var RESOLVE_ISSUE_RECOVERY_ACTION_OUTCOMES = [
  "restored",
  "false_positive",
  "blocked",
  "cancelled"
];
var resolveIssueRecoveryActionSchema = external_exports.object({
  actionId: external_exports.string().uuid().optional(),
  outcome: external_exports.enum(RESOLVE_ISSUE_RECOVERY_ACTION_OUTCOMES),
  sourceIssueStatus: external_exports.enum(["todo", "done", "in_review", "blocked"]),
  resolutionNote: multilineTextSchema.optional().nullable()
}).strict().superRefine((value, ctx) => {
  if (value.outcome === "restored") {
    if (value.sourceIssueStatus !== "todo" && value.sourceIssueStatus !== "done" && value.sourceIssueStatus !== "in_review") {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        message: "Restored recovery actions must move the source issue to todo, done, or in_review",
        path: ["sourceIssueStatus"]
      });
    }
    return;
  }
  if (value.outcome === "blocked") {
    if (value.sourceIssueStatus !== "blocked") {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        message: "Blocked recovery actions must move the source issue to blocked",
        path: ["sourceIssueStatus"]
      });
    }
    return;
  }
  if (value.outcome === "false_positive" || value.outcome === "cancelled") {
    if (value.sourceIssueStatus !== "done" && value.sourceIssueStatus !== "in_review") {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        message: "This recovery outcome requires sourceIssueStatus to be done or in_review",
        path: ["sourceIssueStatus"]
      });
    }
    return;
  }
});
var issueRequestDepthInputSchema = external_exports.number().int().nonnegative().transform((value) => clampIssueRequestDepth(value));
function resolveCreateIssueStatusDefault(input) {
  if (typeof input.status === "string") {
    return {
      status: input.status,
      defaulted: false,
      reason: "explicit"
    };
  }
  const hasAssignee = typeof input.assigneeAgentId === "string" && input.assigneeAgentId.length > 0 || typeof input.assigneeUserId === "string" && input.assigneeUserId.length > 0;
  return {
    status: hasAssignee ? "todo" : "backlog",
    defaulted: true,
    reason: hasAssignee ? "assigned_omitted_status" : "unassigned_omitted_status"
  };
}
function withCreateIssueStatusDefault(schema) {
  return external_exports.preprocess((input) => {
    if (!input || typeof input !== "object" || Array.isArray(input))
      return input;
    const raw = input;
    if (raw.status !== void 0)
      return input;
    return {
      ...raw,
      status: resolveCreateIssueStatusDefault(raw).status
    };
  }, schema);
}
var createIssueBaseSchema = external_exports.object({
  projectId: external_exports.string().uuid().optional().nullable(),
  projectWorkspaceId: external_exports.string().uuid().optional().nullable(),
  goalId: external_exports.string().uuid().optional().nullable(),
  parentId: external_exports.string().uuid().optional().nullable(),
  blockedByIssueIds: external_exports.array(external_exports.string().uuid()).optional(),
  inheritExecutionWorkspaceFromIssueId: external_exports.string().uuid().optional().nullable(),
  title: external_exports.string().min(1),
  description: multilineTextSchema.optional().nullable(),
  status: external_exports.enum(ISSUE_STATUSES),
  workMode: external_exports.enum(ISSUE_WORK_MODES).optional().default("standard"),
  harnessKind: external_exports.enum(ISSUE_HARNESS_KINDS).optional().nullable(),
  priority: external_exports.enum(ISSUE_PRIORITIES).optional().default("medium"),
  assigneeAgentId: external_exports.string().uuid().optional().nullable(),
  assigneeUserId: external_exports.string().optional().nullable(),
  requestDepth: issueRequestDepthInputSchema.optional().default(0),
  createdByUserId: external_exports.string().optional().nullable(),
  responsibleUserId: external_exports.string().optional().nullable(),
  billingCode: external_exports.string().optional().nullable(),
  assigneeAdapterOverrides: issueAssigneeAdapterOverridesSchema.optional().nullable(),
  executionPolicy: issueExecutionPolicySchema.optional().nullable(),
  executionWorkspaceId: external_exports.string().uuid().optional().nullable(),
  executionWorkspacePreference: external_exports.enum(ISSUE_EXECUTION_WORKSPACE_PREFERENCES).optional().nullable(),
  executionWorkspaceSettings: issueExecutionWorkspaceSettingsSchema.optional().nullable(),
  labelIds: external_exports.array(external_exports.string().uuid()).optional(),
  watchdogDiscovery: external_exports.object({
    kind: external_exports.enum(ISSUE_WATCHDOG_DISCOVERY_KINDS),
    evidenceMarkdown: multilineTextSchema.optional().nullable()
  }).strict().optional().nullable(),
  watchdog: external_exports.object({
    agentId: external_exports.string().uuid(),
    instructions: multilineTextSchema.optional().nullable()
  }).strict().optional().nullable()
});
var createIssueDuplicateGuardSchema = {
  idempotencyKey: external_exports.string().trim().min(1).max(255).optional().nullable(),
  allowDuplicate: external_exports.boolean().describe("Bypasses recent-title duplicate detection; idempotency keys always replay their original issue").optional().default(false)
};
var createIssueInputSchema = createIssueBaseSchema.extend({
  status: createIssueBaseSchema.shape.status.optional(),
  ...createIssueDuplicateGuardSchema
});
var createIssueSchema = withCreateIssueStatusDefault(createIssueBaseSchema.extend(createIssueDuplicateGuardSchema));
var upsertIssueWatchdogSchema = external_exports.object({
  agentId: external_exports.string().uuid(),
  instructions: multilineTextSchema.optional().nullable()
}).strict();
var createChildIssueSchema = withCreateIssueStatusDefault(createIssueBaseSchema.omit({
  parentId: true,
  inheritExecutionWorkspaceFromIssueId: true,
  watchdogDiscovery: true
}).extend({
  acceptanceCriteria: external_exports.array(external_exports.string().trim().min(1).max(500)).max(20).optional(),
  blockParentUntilDone: external_exports.boolean().optional().default(false)
}));
var createAcceptedPlanDecompositionSchema = external_exports.object({
  acceptedPlanRevisionId: external_exports.string().uuid(),
  children: external_exports.array(createChildIssueSchema).min(1).max(25)
});
var createIssueLabelSchema = external_exports.object({
  name: external_exports.string().trim().min(1).max(48),
  color: external_exports.string().regex(/^#(?:[0-9a-fA-F]{6})$/, "Color must be a 6-digit hex value")
});
var updateIssueSchema = createIssueBaseSchema.omit({
  createdByUserId: true,
  responsibleUserId: true,
  watchdog: true
}).partial().extend({
  requestDepth: issueRequestDepthInputSchema.optional(),
  assigneeAgentId: external_exports.string().trim().min(1).optional().nullable(),
  comment: multilineTextSchema.pipe(external_exports.string().min(1)).optional(),
  reviewRequest: issueReviewRequestSchema.optional().nullable(),
  reopen: external_exports.boolean().optional(),
  resume: external_exports.boolean().optional(),
  interrupt: external_exports.boolean().optional(),
  hiddenAt: external_exports.string().datetime().nullable().optional()
});
var checkoutIssueSchema = external_exports.object({
  agentId: external_exports.string().uuid(),
  expectedStatuses: external_exports.array(external_exports.enum(ISSUE_STATUSES)).nonempty()
});
var commentMetadataLabelSchema = external_exports.string().trim().min(1).max(120);
var commentMetadataTextSchema = external_exports.string().trim().min(1).max(2e3);
var issueCommentAuthorTypeSchema = external_exports.enum(ISSUE_COMMENT_AUTHOR_TYPES);
var issueCommentPresentationSchema = external_exports.object({
  kind: external_exports.enum(ISSUE_COMMENT_PRESENTATION_KINDS).default("message"),
  tone: external_exports.enum(ISSUE_COMMENT_PRESENTATION_TONES).default("neutral"),
  title: external_exports.string().trim().min(1).max(160).nullable().optional(),
  detailsDefaultOpen: external_exports.boolean().optional().default(false)
}).strict();
var issueCommentMetadataBaseRowSchema = external_exports.object({
  type: external_exports.enum(ISSUE_COMMENT_METADATA_ROW_TYPES),
  label: commentMetadataLabelSchema.nullable().optional()
});
var issueCommentMetadataTextRowSchema = issueCommentMetadataBaseRowSchema.extend({
  type: external_exports.literal("text"),
  text: commentMetadataTextSchema
}).strict();
var issueCommentMetadataCodeRowSchema = issueCommentMetadataBaseRowSchema.extend({
  type: external_exports.literal("code"),
  code: external_exports.string().min(1).max(4e3),
  language: external_exports.string().trim().min(1).max(40).nullable().optional()
}).strict();
var issueCommentMetadataKeyValueRowSchema = issueCommentMetadataBaseRowSchema.extend({
  type: external_exports.literal("key_value"),
  label: commentMetadataLabelSchema,
  value: commentMetadataTextSchema
}).strict();
var issueCommentMetadataIssueLinkRowSchema = issueCommentMetadataBaseRowSchema.extend({
  type: external_exports.literal("issue_link"),
  issueId: external_exports.string().uuid().nullable().optional(),
  identifier: external_exports.string().trim().min(1).max(80).nullable().optional(),
  title: external_exports.string().trim().min(1).max(240).nullable().optional()
}).strict();
var issueCommentMetadataAgentLinkRowSchema = issueCommentMetadataBaseRowSchema.extend({
  type: external_exports.literal("agent_link"),
  agentId: external_exports.string().uuid(),
  name: external_exports.string().trim().min(1).max(160).nullable().optional()
}).strict();
var issueCommentMetadataRunLinkRowSchema = issueCommentMetadataBaseRowSchema.extend({
  type: external_exports.literal("run_link"),
  runId: external_exports.string().uuid(),
  title: external_exports.string().trim().min(1).max(160).nullable().optional()
}).strict();
var issueCommentMetadataRowSchema = external_exports.discriminatedUnion("type", [
  issueCommentMetadataTextRowSchema,
  issueCommentMetadataCodeRowSchema,
  issueCommentMetadataKeyValueRowSchema,
  issueCommentMetadataIssueLinkRowSchema,
  issueCommentMetadataAgentLinkRowSchema,
  issueCommentMetadataRunLinkRowSchema
]).superRefine((value, ctx) => {
  if (value.type === "issue_link" && !value.issueId && !value.identifier) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      message: "Issue link rows require issueId or identifier",
      path: ["issueId"]
    });
  }
});
var issueCommentMetadataSectionSchema = external_exports.object({
  title: external_exports.string().trim().min(1).max(160).nullable().optional(),
  rows: external_exports.array(issueCommentMetadataRowSchema).min(1).max(50)
}).strict();
var issueCommentMetadataSchema = external_exports.object({
  version: external_exports.literal(1),
  sourceRunId: external_exports.string().uuid().nullable().optional(),
  sections: external_exports.array(issueCommentMetadataSectionSchema).min(1).max(20)
}).strict();
var addIssueCommentSchema = external_exports.object({
  body: multilineTextSchema.pipe(external_exports.string().min(1)),
  authorType: issueCommentAuthorTypeSchema.optional(),
  presentation: issueCommentPresentationSchema.nullable().optional(),
  metadata: issueCommentMetadataSchema.nullable().optional(),
  reopen: external_exports.boolean().optional(),
  resume: external_exports.boolean().optional(),
  interrupt: external_exports.boolean().optional()
});
var issueThreadInteractionStatusSchema = external_exports.enum(ISSUE_THREAD_INTERACTION_STATUSES);
var issueThreadInteractionKindSchema = external_exports.enum(ISSUE_THREAD_INTERACTION_KINDS);
var issueThreadInteractionContinuationPolicySchema = external_exports.enum(ISSUE_THREAD_INTERACTION_CONTINUATION_POLICIES);
var issueDocumentKeySchema = external_exports.string().trim().min(1).max(64).regex(/^[a-z0-9][a-z0-9_-]*$/, "Document key must be lowercase letters, numbers, _ or -");
var suggestedTaskDraftSchema = external_exports.object({
  clientKey: external_exports.string().trim().min(1).max(120),
  parentClientKey: external_exports.string().trim().min(1).max(120).nullable().optional(),
  parentId: external_exports.string().uuid().nullable().optional(),
  title: external_exports.string().trim().min(1).max(240),
  description: multilineTextSchema.pipe(external_exports.string().trim().max(2e4)).nullable().optional(),
  priority: external_exports.enum(ISSUE_PRIORITIES).nullable().optional(),
  workMode: external_exports.enum(ISSUE_WORK_MODES).nullable().optional(),
  assigneeAgentId: external_exports.string().uuid().nullable().optional(),
  assigneeUserId: external_exports.string().trim().min(1).nullable().optional(),
  projectId: external_exports.string().uuid().nullable().optional(),
  goalId: external_exports.string().uuid().nullable().optional(),
  billingCode: external_exports.string().trim().max(120).nullable().optional(),
  labels: external_exports.array(external_exports.string().trim().min(1).max(48)).max(20).optional(),
  hiddenInPreview: external_exports.boolean().optional()
}).superRefine((value, ctx) => {
  if (value.assigneeAgentId && value.assigneeUserId) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      message: "Suggested tasks can only target one assignee",
      path: ["assigneeAgentId"]
    });
  }
});
var suggestTasksPayloadSchema = external_exports.object({
  version: external_exports.literal(1),
  defaultParentId: external_exports.string().uuid().nullable().optional(),
  tasks: external_exports.array(suggestedTaskDraftSchema).min(1).max(50)
}).superRefine((value, ctx) => {
  const seenClientKeys = /* @__PURE__ */ new Set();
  for (const [index, task] of value.tasks.entries()) {
    if (seenClientKeys.has(task.clientKey)) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        message: "clientKey must be unique within one interaction",
        path: ["tasks", index, "clientKey"]
      });
      continue;
    }
    seenClientKeys.add(task.clientKey);
  }
});
var suggestTasksResultCreatedTaskSchema = external_exports.object({
  clientKey: external_exports.string().trim().min(1).max(120),
  issueId: external_exports.string().uuid(),
  identifier: external_exports.string().trim().min(1).nullable().optional(),
  title: external_exports.string().trim().min(1).nullable().optional(),
  parentIssueId: external_exports.string().uuid().nullable().optional(),
  parentIdentifier: external_exports.string().trim().min(1).nullable().optional()
});
var suggestTasksResultSchema = external_exports.object({
  version: external_exports.literal(1),
  createdTasks: external_exports.array(suggestTasksResultCreatedTaskSchema).max(50).optional(),
  skippedClientKeys: external_exports.array(external_exports.string().trim().min(1).max(120)).max(50).optional(),
  rejectionReason: external_exports.string().trim().max(4e3).nullable().optional()
});
var askUserQuestionsQuestionOptionSchema = external_exports.object({
  id: external_exports.string().trim().min(1).max(120),
  label: external_exports.string().trim().min(1).max(120),
  description: external_exports.string().trim().max(500).nullable().optional()
});
var askUserQuestionsQuestionSchema = external_exports.object({
  id: external_exports.string().trim().min(1).max(120),
  prompt: external_exports.string().trim().min(1).max(500),
  helpText: external_exports.string().trim().max(1e3).nullable().optional(),
  selectionMode: external_exports.enum(["single", "multi"]),
  required: external_exports.boolean().optional(),
  options: external_exports.array(askUserQuestionsQuestionOptionSchema).min(1).max(10)
});
var askUserQuestionsPayloadSchema = external_exports.object({
  version: external_exports.literal(1),
  title: external_exports.string().trim().max(240).nullable().optional(),
  submitLabel: external_exports.string().trim().max(120).nullable().optional(),
  supersedeOnUserComment: external_exports.boolean().optional(),
  questions: external_exports.array(askUserQuestionsQuestionSchema).min(1).max(10)
}).superRefine((value, ctx) => {
  const seenQuestionIds = /* @__PURE__ */ new Set();
  for (const [questionIndex, question] of value.questions.entries()) {
    if (seenQuestionIds.has(question.id)) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        message: "Question ids must be unique within one interaction",
        path: ["questions", questionIndex, "id"]
      });
    }
    seenQuestionIds.add(question.id);
    const seenOptionIds = /* @__PURE__ */ new Set();
    for (const [optionIndex, option] of question.options.entries()) {
      if (seenOptionIds.has(option.id)) {
        ctx.addIssue({
          code: external_exports.ZodIssueCode.custom,
          message: "Option ids must be unique within one question",
          path: ["questions", questionIndex, "options", optionIndex, "id"]
        });
      }
      seenOptionIds.add(option.id);
    }
  }
});
var askUserQuestionsAnswerSchema = external_exports.object({
  questionId: external_exports.string().trim().min(1).max(120),
  optionIds: external_exports.array(external_exports.string().trim().min(1).max(120)).max(20),
  otherText: multilineTextSchema.pipe(external_exports.string().trim().max(4e3)).nullable().optional()
});
var askUserQuestionsResultSchema = external_exports.object({
  version: external_exports.literal(1),
  answers: external_exports.array(askUserQuestionsAnswerSchema).max(20),
  cancelled: external_exports.literal(true).optional(),
  cancellationReason: external_exports.string().trim().max(4e3).nullable().optional(),
  expirationReason: external_exports.literal("superseded_by_comment").optional(),
  commentId: external_exports.string().uuid().nullable().optional(),
  summaryMarkdown: external_exports.string().max(2e4).nullable().optional()
});
var requestConfirmationHrefSchema = external_exports.string().trim().min(1).max(2e3).refine((value) => {
  if (value.startsWith("#"))
    return true;
  if (value.startsWith("/"))
    return !value.startsWith("//");
  return /^https?:\/\//i.test(value);
}, "href must be a root-relative path, same-page fragment, or http(s) URL");
var requestConfirmationTargetBaseSchema = external_exports.object({
  label: external_exports.string().trim().min(1).max(120).nullable().optional(),
  href: requestConfirmationHrefSchema.nullable().optional()
});
var requestConfirmationIssueDocumentTargetSchema = requestConfirmationTargetBaseSchema.extend({
  type: external_exports.literal("issue_document"),
  issueId: external_exports.string().uuid().nullable().optional(),
  documentId: external_exports.string().uuid().nullable().optional(),
  key: issueDocumentKeySchema,
  revisionId: external_exports.string().uuid(),
  revisionNumber: external_exports.number().int().positive().nullable().optional()
});
var requestConfirmationCustomTargetSchema = requestConfirmationTargetBaseSchema.extend({
  type: external_exports.literal("custom"),
  key: external_exports.string().trim().min(1).max(120),
  revisionId: external_exports.string().trim().min(1).max(255).nullable().optional(),
  revisionNumber: external_exports.number().int().positive().nullable().optional()
});
var requestConfirmationTargetSchema = external_exports.discriminatedUnion("type", [
  requestConfirmationIssueDocumentTargetSchema,
  requestConfirmationCustomTargetSchema
]);
var requestConfirmationToolActionPayloadSchema = external_exports.object({
  version: external_exports.literal(1),
  actionRequestId: external_exports.string().uuid(),
  invocationId: external_exports.string().uuid(),
  toolName: external_exports.string().trim().min(1).max(500),
  toolDisplayName: external_exports.string().trim().min(1).max(500),
  connectionId: external_exports.string().uuid().nullable(),
  applicationId: external_exports.string().uuid().nullable(),
  appDisplayName: external_exports.string().trim().min(1).max(500).nullable(),
  risk: external_exports.enum(["write", "destructive"]),
  previewMarkdown: external_exports.string().trim().min(1).max(2e4),
  argumentsSummaryJson: external_exports.string().max(2e4),
  argumentsHash: external_exports.string().trim().min(1).max(255),
  expiresAt: external_exports.string().datetime({ offset: true })
});
var requestConfirmationPayloadSchema = external_exports.object({
  version: external_exports.literal(1),
  prompt: external_exports.string().trim().min(1).max(1e3),
  acceptLabel: external_exports.string().trim().min(1).max(80).nullable().optional(),
  rejectLabel: external_exports.string().trim().min(1).max(80).nullable().optional(),
  rejectRequiresReason: external_exports.boolean().optional(),
  rejectReasonLabel: external_exports.string().trim().min(1).max(160).nullable().optional(),
  allowDeclineReason: external_exports.boolean().optional().default(true),
  declineReasonPlaceholder: external_exports.string().trim().min(1).max(240).nullable().optional(),
  detailsMarkdown: external_exports.string().max(2e4).nullable().optional(),
  supersedeOnUserComment: external_exports.boolean().optional(),
  target: requestConfirmationTargetSchema.nullable().optional(),
  toolAction: requestConfirmationToolActionPayloadSchema.optional()
});
var requestCheckboxConfirmationOptionSchema = external_exports.object({
  id: external_exports.string().trim().min(1).max(120),
  label: external_exports.string().trim().min(1).max(120),
  description: external_exports.string().trim().max(500).nullable().optional()
});
var requestCheckboxConfirmationPayloadSchema = external_exports.object({
  version: external_exports.literal(1),
  prompt: external_exports.string().trim().min(1).max(1e3),
  detailsMarkdown: external_exports.string().max(2e4).nullable().optional(),
  options: external_exports.array(requestCheckboxConfirmationOptionSchema).min(1).max(REQUEST_CHECKBOX_CONFIRMATION_OPTION_LIMIT),
  defaultSelectedOptionIds: external_exports.array(external_exports.string().trim().min(1).max(120)).max(REQUEST_CHECKBOX_CONFIRMATION_OPTION_LIMIT).optional().default([]),
  minSelected: external_exports.number().int().min(0).optional().default(0),
  maxSelected: external_exports.number().int().min(0).nullable().optional(),
  acceptLabel: external_exports.string().trim().min(1).max(80).nullable().optional(),
  rejectLabel: external_exports.string().trim().min(1).max(80).nullable().optional(),
  rejectRequiresReason: external_exports.boolean().optional(),
  rejectReasonLabel: external_exports.string().trim().min(1).max(160).nullable().optional(),
  allowDeclineReason: external_exports.boolean().optional().default(true),
  declineReasonPlaceholder: external_exports.string().trim().min(1).max(240).nullable().optional(),
  supersedeOnUserComment: external_exports.boolean().optional(),
  target: requestConfirmationTargetSchema.nullable().optional()
}).superRefine((value, ctx) => {
  const optionIds = /* @__PURE__ */ new Set();
  for (const [index, option] of value.options.entries()) {
    if (optionIds.has(option.id)) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        message: "Option ids must be unique within one checkbox confirmation",
        path: ["options", index, "id"]
      });
    }
    optionIds.add(option.id);
  }
  const defaultSelectedOptionIds = /* @__PURE__ */ new Set();
  for (const [index, optionId] of value.defaultSelectedOptionIds.entries()) {
    if (defaultSelectedOptionIds.has(optionId)) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        message: "defaultSelectedOptionIds must be unique",
        path: ["defaultSelectedOptionIds", index]
      });
      continue;
    }
    defaultSelectedOptionIds.add(optionId);
    if (!optionIds.has(optionId)) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        message: "defaultSelectedOptionIds must reference existing option ids",
        path: ["defaultSelectedOptionIds", index]
      });
    }
  }
  const maxSelected = value.maxSelected ?? null;
  if (value.minSelected > value.options.length) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      message: "minSelected cannot exceed the option count",
      path: ["minSelected"]
    });
  }
  if (value.defaultSelectedOptionIds.length < value.minSelected) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      message: "defaultSelectedOptionIds must satisfy minSelected",
      path: ["defaultSelectedOptionIds"]
    });
  }
  if (maxSelected != null) {
    if (maxSelected < value.minSelected) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        message: "maxSelected must be greater than or equal to minSelected",
        path: ["maxSelected"]
      });
    }
    if (maxSelected > value.options.length) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        message: "maxSelected cannot exceed the option count",
        path: ["maxSelected"]
      });
    }
    if (value.defaultSelectedOptionIds.length > maxSelected) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        message: "defaultSelectedOptionIds cannot exceed maxSelected",
        path: ["defaultSelectedOptionIds"]
      });
    }
  }
});
var requestConfirmationResumeFailureSchema = external_exports.object({
  status: external_exports.enum(["retrying", "needs_attention"]),
  errorCode: external_exports.string().trim().min(1).max(120).nullable(),
  attempt: external_exports.number().int().min(0).max(100),
  maxAttempts: external_exports.number().int().min(0).max(100),
  runId: external_exports.string().uuid().nullable().optional(),
  retryRunId: external_exports.string().uuid().nullable().optional(),
  recoveryActionId: external_exports.string().uuid().nullable().optional(),
  updatedAt: external_exports.string().trim().min(1).nullable().optional()
});
var requestConfirmationToolActionResultSchema = external_exports.object({
  version: external_exports.literal(1),
  status: external_exports.enum(["approved", "executing", "executed", "failed", "expired"]),
  errorCode: external_exports.string().trim().min(1).max(120).nullable().optional(),
  errorMessage: external_exports.string().trim().min(1).max(4e3).nullable().optional(),
  // Populated on `executed` so the card can report the outcome (e.g. "Row 42
  // added") instead of a bare checkmark, with an optional deep-link when the
  // connector returns a URL (PAP-13745 §5 Executed / Peak-End).
  resultSummary: external_exports.string().trim().min(1).max(4e3).nullable().optional(),
  resultHref: external_exports.string().trim().url().max(2e3).nullable().optional(),
  updatedAt: external_exports.string().datetime({ offset: true })
});
var requestConfirmationResultSchema = external_exports.object({
  version: external_exports.literal(1),
  outcome: external_exports.enum(["accepted", "rejected", "superseded_by_comment", "stale_target"]),
  reason: external_exports.string().trim().max(4e3).nullable().optional(),
  commentId: external_exports.string().uuid().nullable().optional(),
  staleTarget: requestConfirmationTargetSchema.nullable().optional(),
  resumeFailure: requestConfirmationResumeFailureSchema.nullable().optional(),
  toolAction: requestConfirmationToolActionResultSchema.optional()
});
var requestCheckboxConfirmationResultSchema = requestConfirmationResultSchema.extend({
  selectedOptionIds: external_exports.array(external_exports.string().trim().min(1).max(120)).max(REQUEST_CHECKBOX_CONFIRMATION_OPTION_LIMIT).optional()
}).superRefine((value, ctx) => {
  const selectedOptionIds = value.selectedOptionIds ?? [];
  const seenOptionIds = /* @__PURE__ */ new Set();
  for (const [index, optionId] of selectedOptionIds.entries()) {
    if (seenOptionIds.has(optionId)) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        message: "selectedOptionIds must be unique",
        path: ["selectedOptionIds", index]
      });
    }
    seenOptionIds.add(optionId);
  }
});
var requestItemVerdictValueSchema = external_exports.enum(["approve", "reject", "defer"]);
var requestItemVerdictsItemSchema = external_exports.object({
  id: external_exports.string().trim().min(1).max(120),
  label: external_exports.string().trim().min(1).max(120),
  description: external_exports.string().trim().max(500).nullable().optional(),
  previewMarkdown: external_exports.string().max(2e4).nullable().optional(),
  href: requestConfirmationHrefSchema.nullable().optional(),
  attachmentId: external_exports.string().uuid().nullable().optional()
});
var requestItemVerdictsPayloadSchema = external_exports.object({
  version: external_exports.literal(1),
  prompt: external_exports.string().trim().min(1).max(1e3),
  detailsMarkdown: external_exports.string().max(2e4).nullable().optional(),
  items: external_exports.array(requestItemVerdictsItemSchema).min(1).max(REQUEST_ITEM_VERDICTS_ITEM_LIMIT),
  verdicts: external_exports.array(requestItemVerdictValueSchema).min(2).max(3).optional().default(["approve", "reject"]),
  requireReasonOn: external_exports.array(requestItemVerdictValueSchema).max(3).optional().default(["reject"]),
  reasonLabel: external_exports.string().trim().min(1).max(160).nullable().optional(),
  allowBulkApprove: external_exports.boolean().optional().default(true),
  supersedeOnUserComment: external_exports.boolean().optional(),
  target: requestConfirmationTargetSchema.nullable().optional()
}).superRefine((value, ctx) => {
  const itemIds = /* @__PURE__ */ new Set();
  for (const [index, item] of value.items.entries()) {
    if (itemIds.has(item.id)) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        message: "Item ids must be unique within one item verdict request",
        path: ["items", index, "id"]
      });
    }
    itemIds.add(item.id);
  }
  const verdicts = /* @__PURE__ */ new Set();
  for (const [index, verdict] of value.verdicts.entries()) {
    if (verdicts.has(verdict)) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        message: "verdicts must be unique",
        path: ["verdicts", index]
      });
    }
    verdicts.add(verdict);
  }
  if (!verdicts.has("approve") || !verdicts.has("reject")) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      message: "verdicts must include approve and reject; defer is optional",
      path: ["verdicts"]
    });
  }
  const reasonVerdicts = /* @__PURE__ */ new Set();
  for (const [index, verdict] of value.requireReasonOn.entries()) {
    if (reasonVerdicts.has(verdict)) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        message: "requireReasonOn must be unique",
        path: ["requireReasonOn", index]
      });
      continue;
    }
    reasonVerdicts.add(verdict);
    if (!verdicts.has(verdict)) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        message: "requireReasonOn must reference enabled verdicts",
        path: ["requireReasonOn", index]
      });
    }
  }
});
var requestItemVerdictsResultItemSchema = external_exports.object({
  id: external_exports.string().trim().min(1).max(120),
  verdict: requestItemVerdictValueSchema,
  reason: external_exports.string().trim().max(4e3).nullable().optional(),
  resolvedByUserId: external_exports.string().trim().min(1).max(255),
  resolvedAt: external_exports.union([external_exports.string().datetime(), external_exports.date()]),
  commentId: external_exports.string().uuid().nullable().optional()
});
var requestItemVerdictsResultSchema = external_exports.object({
  version: external_exports.literal(1),
  outcome: external_exports.enum(["resolved", "superseded_by_comment", "stale_target", "cancelled"]),
  complete: external_exports.boolean(),
  items: external_exports.array(requestItemVerdictsResultItemSchema).max(REQUEST_ITEM_VERDICTS_ITEM_LIMIT),
  commentId: external_exports.string().uuid().nullable().optional(),
  staleTarget: requestConfirmationTargetSchema.nullable().optional()
}).superRefine((value, ctx) => {
  const itemIds = /* @__PURE__ */ new Set();
  for (const [index, item] of value.items.entries()) {
    if (itemIds.has(item.id)) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        message: "result item ids must be unique",
        path: ["items", index, "id"]
      });
    }
    itemIds.add(item.id);
  }
});
var createIssueThreadInteractionSchema = external_exports.discriminatedUnion("kind", [
  external_exports.object({
    kind: external_exports.literal("suggest_tasks"),
    idempotencyKey: external_exports.string().trim().max(255).nullable().optional(),
    sourceCommentId: external_exports.string().uuid().nullable().optional(),
    sourceRunId: external_exports.string().uuid().nullable().optional(),
    title: external_exports.string().trim().max(240).nullable().optional(),
    summary: external_exports.string().trim().max(1e3).nullable().optional(),
    continuationPolicy: issueThreadInteractionContinuationPolicySchema.optional().default("wake_assignee"),
    payload: suggestTasksPayloadSchema
  }),
  external_exports.object({
    kind: external_exports.literal("ask_user_questions"),
    idempotencyKey: external_exports.string().trim().max(255).nullable().optional(),
    sourceCommentId: external_exports.string().uuid().nullable().optional(),
    sourceRunId: external_exports.string().uuid().nullable().optional(),
    title: external_exports.string().trim().max(240).nullable().optional(),
    summary: external_exports.string().trim().max(1e3).nullable().optional(),
    continuationPolicy: issueThreadInteractionContinuationPolicySchema.optional().default("wake_assignee"),
    payload: askUserQuestionsPayloadSchema
  }),
  external_exports.object({
    kind: external_exports.literal("request_confirmation"),
    idempotencyKey: external_exports.string().trim().max(255).nullable().optional(),
    sourceCommentId: external_exports.string().uuid().nullable().optional(),
    sourceRunId: external_exports.string().uuid().nullable().optional(),
    title: external_exports.string().trim().max(240).nullable().optional(),
    summary: external_exports.string().trim().max(1e3).nullable().optional(),
    continuationPolicy: issueThreadInteractionContinuationPolicySchema.optional().default("none"),
    payload: requestConfirmationPayloadSchema
  }),
  external_exports.object({
    kind: external_exports.literal("request_checkbox_confirmation"),
    idempotencyKey: external_exports.string().trim().max(255).nullable().optional(),
    sourceCommentId: external_exports.string().uuid().nullable().optional(),
    sourceRunId: external_exports.string().uuid().nullable().optional(),
    title: external_exports.string().trim().max(240).nullable().optional(),
    summary: external_exports.string().trim().max(1e3).nullable().optional(),
    continuationPolicy: issueThreadInteractionContinuationPolicySchema.optional().default("wake_assignee"),
    payload: requestCheckboxConfirmationPayloadSchema
  }),
  external_exports.object({
    kind: external_exports.literal("request_item_verdicts"),
    idempotencyKey: external_exports.string().trim().max(255).nullable().optional(),
    sourceCommentId: external_exports.string().uuid().nullable().optional(),
    sourceRunId: external_exports.string().uuid().nullable().optional(),
    title: external_exports.string().trim().max(240).nullable().optional(),
    summary: external_exports.string().trim().max(1e3).nullable().optional(),
    continuationPolicy: issueThreadInteractionContinuationPolicySchema.optional().default("wake_assignee"),
    payload: requestItemVerdictsPayloadSchema
  })
]);
var acceptIssueThreadInteractionSchema = external_exports.object({
  selectedClientKeys: external_exports.array(external_exports.string().trim().min(1).max(120)).min(1).max(50).optional(),
  selectedOptionIds: external_exports.array(external_exports.string().trim().min(1).max(120)).max(REQUEST_CHECKBOX_CONFIRMATION_OPTION_LIMIT).optional()
}).superRefine((value, ctx) => {
  const seenClientKeys = /* @__PURE__ */ new Set();
  for (const [index, clientKey] of (value.selectedClientKeys ?? []).entries()) {
    if (seenClientKeys.has(clientKey)) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        message: "selectedClientKeys must be unique",
        path: ["selectedClientKeys", index]
      });
      continue;
    }
    seenClientKeys.add(clientKey);
  }
  const seenOptionIds = /* @__PURE__ */ new Set();
  for (const [index, optionId] of (value.selectedOptionIds ?? []).entries()) {
    if (seenOptionIds.has(optionId)) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        message: "selectedOptionIds must be unique",
        path: ["selectedOptionIds", index]
      });
      continue;
    }
    seenOptionIds.add(optionId);
  }
});
var rejectIssueThreadInteractionSchema = external_exports.object({
  reason: external_exports.string().trim().max(4e3).optional()
});
var cancelIssueThreadInteractionSchema = external_exports.object({
  reason: external_exports.string().trim().max(4e3).optional()
});
var respondIssueThreadInteractionSchema = external_exports.object({
  answers: external_exports.array(askUserQuestionsAnswerSchema).max(20),
  summaryMarkdown: multilineTextSchema.pipe(external_exports.string().max(2e4)).nullable().optional()
});
var submitIssueThreadInteractionVerdictsSchema = external_exports.object({
  verdicts: external_exports.array(external_exports.object({
    id: external_exports.string().trim().min(1).max(120),
    verdict: requestItemVerdictValueSchema,
    reason: external_exports.string().trim().max(4e3).nullable().optional()
  })).min(1).max(REQUEST_ITEM_VERDICTS_ITEM_LIMIT)
}).superRefine((value, ctx) => {
  const itemIds = /* @__PURE__ */ new Set();
  for (const [index, verdict] of value.verdicts.entries()) {
    if (itemIds.has(verdict.id)) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        message: "verdict item ids must be unique",
        path: ["verdicts", index, "id"]
      });
    }
    itemIds.add(verdict.id);
  }
});
var linkIssueApprovalSchema = external_exports.object({
  approvalId: external_exports.string().uuid()
});
var createIssueAttachmentMetadataSchema = external_exports.object({
  issueCommentId: external_exports.string().uuid().optional().nullable()
});
var ISSUE_DOCUMENT_FORMATS = ["markdown"];
var issueDocumentFormatSchema = external_exports.enum(ISSUE_DOCUMENT_FORMATS);
var upsertIssueDocumentSchema = external_exports.object({
  title: external_exports.string().trim().max(200).nullable().optional(),
  format: issueDocumentFormatSchema,
  body: multilineTextSchema.pipe(external_exports.string().max(524288)),
  changeSummary: external_exports.string().trim().max(500).nullable().optional(),
  baseRevisionId: external_exports.string().uuid().nullable().optional()
});
var restoreIssueDocumentRevisionSchema = external_exports.object({});

// ../../node_modules/.pnpm/@paperclipai+shared@2026.722.0/node_modules/@paperclipai/shared/dist/validators/secret.js
var secretKeySchema = external_exports.string().trim().min(1).max(120).regex(/^[a-zA-Z0-9_.-]+$/);
var secretVersionSelectorSchema = external_exports.union([external_exports.literal("latest"), external_exports.number().int().positive()]);
var creatableSecretStatusSchema = external_exports.enum(["active", "disabled", "archived"]);
var envBindingPlainSchema = external_exports.object({
  type: external_exports.literal("plain"),
  value: external_exports.string()
});
var envBindingSecretRefSchema = external_exports.object({
  type: external_exports.literal("secret_ref"),
  secretId: external_exports.string().uuid(),
  version: secretVersionSelectorSchema.optional(),
  projectionClass: external_exports.enum(SECRET_PROJECTION_CLASSES).optional(),
  projectionAllowlistKey: external_exports.string().trim().min(1).max(160).optional().nullable()
});
var envBindingUserSecretRefSchema = external_exports.object({
  type: external_exports.literal("user_secret_ref"),
  key: secretKeySchema,
  version: secretVersionSelectorSchema.optional(),
  required: external_exports.boolean().optional().default(true),
  allowMissingOverride: external_exports.boolean().optional().default(false)
});
var envBindingSchema = external_exports.union([
  external_exports.string(),
  envBindingPlainSchema,
  envBindingSecretRefSchema,
  envBindingUserSecretRefSchema
]);
var envConfigSchema = external_exports.record(external_exports.string(), envBindingSchema);
var createSecretSchema = external_exports.object({
  name: external_exports.string().min(1),
  key: secretKeySchema.optional(),
  provider: external_exports.enum(SECRET_PROVIDERS).optional(),
  providerConfigId: external_exports.string().uuid().optional().nullable(),
  managedMode: external_exports.enum(SECRET_MANAGED_MODES).optional(),
  value: external_exports.string().min(1).optional().nullable(),
  description: external_exports.string().optional().nullable(),
  externalRef: external_exports.string().optional().nullable(),
  providerMetadata: external_exports.record(external_exports.string(), external_exports.unknown()).optional().nullable(),
  providerVersionRef: external_exports.string().optional().nullable()
}).superRefine((value, ctx) => {
  if ((value.managedMode ?? "paperclip_managed") === "external_reference") {
    if (!value.externalRef?.trim()) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        path: ["externalRef"],
        message: "External reference secrets require externalRef"
      });
    }
    return;
  }
  if (value.externalRef?.trim()) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["externalRef"],
      message: "Managed secrets cannot set externalRef"
    });
  }
  if (!value.value?.trim()) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["value"],
      message: "Managed secrets require value"
    });
  }
});
function requireSecretRotationInput(value, ctx) {
  if (!value.value?.trim() && !value.externalRef?.trim() && value.providerVersionRef == null && value.providerConfigId == null) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["value"],
      message: "Secret rotation requires value, externalRef, providerVersionRef, or providerConfigId"
    });
  }
}
var rotateSecretSchema = external_exports.object({
  value: external_exports.string().min(1).optional().nullable(),
  externalRef: external_exports.string().optional().nullable(),
  providerVersionRef: external_exports.string().optional().nullable(),
  providerConfigId: external_exports.string().uuid().optional().nullable()
}).superRefine(requireSecretRotationInput);
var updateSecretSchema = external_exports.object({
  name: external_exports.string().min(1).optional(),
  key: secretKeySchema.optional(),
  status: external_exports.enum(SECRET_STATUSES).optional(),
  providerConfigId: external_exports.string().uuid().optional().nullable(),
  description: external_exports.string().optional().nullable(),
  externalRef: external_exports.string().optional().nullable(),
  providerMetadata: external_exports.record(external_exports.string(), external_exports.unknown()).optional().nullable()
});
var secretBindingTargetSchema = external_exports.object({
  targetType: external_exports.enum(SECRET_BINDING_TARGET_TYPES),
  targetId: external_exports.string().min(1),
  configPath: external_exports.string().min(1)
});
var createSecretBindingSchema = secretBindingTargetSchema.extend({
  secretId: external_exports.string().uuid(),
  versionSelector: secretVersionSelectorSchema.default("latest"),
  required: external_exports.boolean().default(true),
  label: external_exports.string().optional().nullable(),
  projectionClass: external_exports.enum(SECRET_PROJECTION_CLASSES).optional(),
  projectionAllowlistKey: external_exports.string().trim().min(1).max(160).optional().nullable()
});
var createUserSecretDefinitionSchema = external_exports.object({
  key: secretKeySchema,
  name: external_exports.string().trim().min(1).max(160),
  description: external_exports.string().trim().max(500).optional().nullable(),
  status: creatableSecretStatusSchema.optional(),
  provider: external_exports.enum(SECRET_PROVIDERS).optional(),
  providerConfigId: external_exports.string().uuid().optional().nullable(),
  managedMode: external_exports.enum(SECRET_MANAGED_MODES).optional(),
  providerMetadata: external_exports.record(external_exports.string(), external_exports.unknown()).optional().nullable(),
  usageGuidance: external_exports.string().trim().max(1e3).optional().nullable()
});
var updateUserSecretDefinitionSchema = external_exports.object({
  name: external_exports.string().trim().min(1).max(160).optional(),
  description: external_exports.string().trim().max(500).optional().nullable(),
  status: external_exports.enum(SECRET_STATUSES).optional(),
  providerConfigId: external_exports.string().uuid().optional().nullable(),
  providerMetadata: external_exports.record(external_exports.string(), external_exports.unknown()).optional().nullable(),
  usageGuidance: external_exports.string().trim().max(1e3).optional().nullable()
});
var createUserSecretValueSchema = external_exports.object({
  definitionKey: secretKeySchema.optional(),
  definitionId: external_exports.string().uuid().optional(),
  value: external_exports.string().min(1).optional().nullable(),
  externalRef: external_exports.string().optional().nullable(),
  providerVersionRef: external_exports.string().optional().nullable(),
  providerConfigId: external_exports.string().uuid().optional().nullable()
}).superRefine((value, ctx) => {
  if (!value.definitionKey && !value.definitionId) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["definitionId"],
      message: "User secret value requires definitionId or definitionKey"
    });
  }
  if (!value.value?.trim() && !value.externalRef?.trim()) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["value"],
      message: "User secret value requires value or externalRef"
    });
  }
});
var updateUserSecretValueSchema = external_exports.object({
  status: external_exports.enum(SECRET_STATUSES).optional(),
  value: external_exports.string().min(1).optional().nullable(),
  externalRef: external_exports.string().min(1).optional().nullable(),
  providerVersionRef: external_exports.string().min(1).optional().nullable(),
  providerConfigId: external_exports.string().uuid().optional().nullable()
});
var rotateUserSecretValueSchema = external_exports.object({
  value: external_exports.string().min(1).optional().nullable(),
  externalRef: external_exports.string().min(1).optional().nullable(),
  providerVersionRef: external_exports.string().min(1).optional().nullable(),
  providerConfigId: external_exports.string().uuid().optional().nullable()
}).superRefine(requireSecretRotationInput);
var createUserSecretDeclarationSchema = secretBindingTargetSchema.extend({
  definitionKey: secretKeySchema,
  envKey: external_exports.string().trim().min(1),
  versionSelector: secretVersionSelectorSchema.default("latest"),
  required: external_exports.boolean().default(true),
  allowMissingOverride: external_exports.boolean().default(false),
  label: external_exports.string().optional().nullable()
});
var safeShortText = external_exports.string().trim().min(1).max(160);
var optionalSafeShortText = safeShortText.optional().nullable();
var deniedProviderConfigKeyPattern = /^(access[-_]?key([-_]?id)?|secret[-_]?access[-_]?key|secret[-_]?key|token|password|passwd|credential|credentials|private[-_]?key|pem|jwt|session[-_]?token|service[-_]?account([-_]?json)?|client[-_]?secret|secret[-_]?id|unseal[-_]?key|recovery[-_]?key|key[-_]?file([-_]?path)?|token[-_]?file([-_]?path)?)$/i;
function rejectSensitiveProviderConfigKeys(value, ctx) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return;
  for (const key of Object.keys(value)) {
    if (!deniedProviderConfigKeyPattern.test(key))
      continue;
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["config", key],
      message: `Provider vault config cannot persist sensitive field: ${key}`
    });
  }
}
var localEncryptedProviderConfigSchema = external_exports.object({
  backupReminderAcknowledged: external_exports.boolean().optional()
}).strict();
var awsSecretsManagerProviderConfigSchema = external_exports.object({
  region: external_exports.string().trim().regex(/^[a-z]{2}(?:-gov)?-[a-z]+-\d+$/, "Invalid AWS region"),
  namespace: optionalSafeShortText,
  secretNamePrefix: optionalSafeShortText,
  kmsKeyId: external_exports.string().trim().min(1).max(512).optional().nullable(),
  ownerTag: optionalSafeShortText,
  environmentTag: optionalSafeShortText
}).strict();
var gcpSecretManagerProviderConfigSchema = external_exports.object({
  projectId: external_exports.string().trim().min(1).max(128).regex(/^[a-z][a-z0-9-]{4,127}$/).optional().nullable(),
  location: optionalSafeShortText,
  namespace: optionalSafeShortText,
  secretNamePrefix: optionalSafeShortText
}).strict();
var vaultAddressSchema = external_exports.preprocess((value) => typeof value === "string" ? value.trim() : value, external_exports.string().url().superRefine((value, ctx) => {
  let url;
  try {
    url = new URL(value);
  } catch {
    return;
  }
  const hasPath = url.pathname !== "" && url.pathname !== "/";
  if (url.protocol !== "http:" && url.protocol !== "https:" || url.username || url.password || url.search || url.hash || hasPath) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      message: "Vault address must be an origin-only HTTP(S) URL without credentials, path, query, or fragment"
    });
  }
}).transform((value) => new URL(value).origin));
function rejectUnsafeVaultAddress(value, ctx) {
  if (value === void 0 || value === null)
    return;
  const parsed = vaultAddressSchema.safeParse(value);
  if (parsed.success)
    return;
  for (const issue of parsed.error.issues) {
    ctx.addIssue({
      ...issue,
      path: ["config", "address", ...issue.path]
    });
  }
}
var vaultProviderConfigSchema = external_exports.object({
  address: vaultAddressSchema.optional().nullable(),
  namespace: optionalSafeShortText,
  mountPath: optionalSafeShortText,
  secretPathPrefix: optionalSafeShortText
}).strict();
var secretProviderConfigPayloadSchema = external_exports.discriminatedUnion("provider", [
  external_exports.object({ provider: external_exports.literal("local_encrypted"), config: localEncryptedProviderConfigSchema }),
  external_exports.object({ provider: external_exports.literal("aws_secrets_manager"), config: awsSecretsManagerProviderConfigSchema }),
  external_exports.object({ provider: external_exports.literal("gcp_secret_manager"), config: gcpSecretManagerProviderConfigSchema }),
  external_exports.object({ provider: external_exports.literal("vault"), config: vaultProviderConfigSchema })
]);
var createSecretProviderConfigSchema = external_exports.object({
  provider: external_exports.enum(SECRET_PROVIDERS),
  displayName: external_exports.string().trim().min(1).max(120),
  status: external_exports.enum(SECRET_PROVIDER_CONFIG_STATUSES).optional(),
  isDefault: external_exports.boolean().optional(),
  config: external_exports.record(external_exports.string(), external_exports.unknown()).default({})
}).superRefine((value, ctx) => {
  rejectSensitiveProviderConfigKeys(value.config, ctx);
  const parsed = secretProviderConfigPayloadSchema.safeParse({
    provider: value.provider,
    config: value.config
  });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      ctx.addIssue({
        ...issue,
        path: issue.path[0] === "config" ? issue.path : ["config", ...issue.path]
      });
    }
  }
  const status = value.status ?? (["gcp_secret_manager", "vault"].includes(value.provider) ? "coming_soon" : "ready");
  if ((value.provider === "gcp_secret_manager" || value.provider === "vault") && status !== "coming_soon" && status !== "disabled") {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["status"],
      message: `${value.provider} provider vaults are locked while coming soon`
    });
  }
  if ((status === "coming_soon" || status === "disabled") && value.isDefault) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["isDefault"],
      message: "Only ready or warning provider vaults can be default"
    });
  }
});
var updateSecretProviderConfigSchema = external_exports.object({
  displayName: external_exports.string().trim().min(1).max(120).optional(),
  status: external_exports.enum(SECRET_PROVIDER_CONFIG_STATUSES).optional(),
  isDefault: external_exports.boolean().optional(),
  config: external_exports.record(external_exports.string(), external_exports.unknown()).optional()
}).superRefine((value, ctx) => {
  if (value.config !== void 0) {
    rejectSensitiveProviderConfigKeys(value.config, ctx);
    rejectUnsafeVaultAddress(value.config.address, ctx);
  }
  if ((value.status === "coming_soon" || value.status === "disabled") && value.isDefault) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["isDefault"],
      message: "Only ready or warning provider vaults can be default"
    });
  }
});
var remoteSecretImportPreviewSchema = external_exports.object({
  providerConfigId: external_exports.string().uuid(),
  query: external_exports.string().trim().max(200).optional().nullable(),
  nextToken: external_exports.string().trim().min(1).max(4096).optional().nullable(),
  pageSize: external_exports.number().int().min(1).max(100).optional()
});
var secretProviderConfigDiscoveryPreviewSchema = external_exports.object({
  provider: external_exports.enum(SECRET_PROVIDERS),
  config: external_exports.record(external_exports.unknown()).default({}),
  query: external_exports.string().trim().max(200).optional().nullable(),
  nextToken: external_exports.string().trim().min(1).max(4096).optional().nullable(),
  pageSize: external_exports.number().int().min(1).max(100).optional()
}).superRefine((value, ctx) => {
  rejectSensitiveProviderConfigKeys(value.config, ctx);
  const parsed = secretProviderConfigPayloadSchema.safeParse({
    provider: value.provider,
    config: value.config
  });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      ctx.addIssue({
        ...issue,
        path: issue.path[0] === "config" ? issue.path : ["config", ...issue.path]
      });
    }
  }
});
var remoteSecretImportSelectionSchema = external_exports.object({
  externalRef: external_exports.string().trim().min(1).max(2048),
  name: external_exports.string().trim().min(1).max(160).optional().nullable(),
  key: external_exports.string().trim().min(1).max(120).regex(/^[a-zA-Z0-9_.-]+$/).optional().nullable(),
  description: external_exports.string().trim().max(500).optional().nullable(),
  providerVersionRef: external_exports.string().trim().min(1).max(512).optional().nullable(),
  providerMetadata: external_exports.record(external_exports.string(), external_exports.unknown()).optional().nullable()
});
var remoteSecretImportSchema = external_exports.object({
  providerConfigId: external_exports.string().uuid(),
  secrets: external_exports.array(remoteSecretImportSelectionSchema).min(1).max(100)
});

// ../../node_modules/.pnpm/@paperclipai+shared@2026.722.0/node_modules/@paperclipai/shared/dist/routine-variables.js
var HUMAN_TIMESTAMP_FORMATTER = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
  timeZone: "UTC",
  timeZoneName: "short"
});
function isValidRoutineDateString(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match)
    return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12)
    return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31
  ][month - 1];
  return day >= 1 && day <= daysInMonth;
}

// ../../node_modules/.pnpm/@paperclipai+shared@2026.722.0/node_modules/@paperclipai/shared/dist/validators/routine.js
var routineVariableValueSchema = external_exports.union([external_exports.string(), external_exports.number().finite(), external_exports.boolean()]);
var routineVariableSchema = external_exports.object({
  name: external_exports.string().trim().regex(/^[A-Za-z][A-Za-z0-9_]*$/),
  label: external_exports.string().trim().max(120).optional().nullable(),
  type: external_exports.enum(ROUTINE_VARIABLE_TYPES).optional().default("text"),
  defaultValue: routineVariableValueSchema.optional().nullable(),
  required: external_exports.boolean().optional().default(true),
  options: external_exports.array(external_exports.string().trim().min(1).max(120)).max(50).optional().default([])
}).superRefine((value, ctx) => {
  if (value.type === "select" && value.options.length === 0) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["options"],
      message: "Select variables require at least one option"
    });
  }
  if (value.type !== "select" && value.options.length > 0) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["options"],
      message: "Only select variables can define options"
    });
  }
  if (value.type === "select" && value.defaultValue != null) {
    if (typeof value.defaultValue !== "string" || !value.options.includes(value.defaultValue)) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        path: ["defaultValue"],
        message: "Select variable defaults must match one of the allowed options"
      });
    }
  }
  if (value.type === "date" && value.defaultValue != null) {
    if (typeof value.defaultValue !== "string" || !isValidRoutineDateString(value.defaultValue)) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        path: ["defaultValue"],
        message: "Date variable defaults must be valid YYYY-MM-DD calendar dates"
      });
    }
  }
});
var createRoutineSchema = external_exports.object({
  projectId: external_exports.string().uuid().optional().nullable(),
  folderId: external_exports.string().uuid().optional().nullable(),
  goalId: external_exports.string().uuid().optional().nullable(),
  parentIssueId: external_exports.string().uuid().optional().nullable(),
  title: external_exports.string().trim().min(1).max(200),
  description: external_exports.string().optional().nullable(),
  assigneeAgentId: external_exports.string().uuid().optional().nullable(),
  priority: external_exports.enum(ISSUE_PRIORITIES).optional().default("medium"),
  status: external_exports.enum(ROUTINE_STATUSES).optional().default("active"),
  concurrencyPolicy: external_exports.enum(ROUTINE_CONCURRENCY_POLICIES).optional().default("coalesce_if_active"),
  catchUpPolicy: external_exports.enum(ROUTINE_CATCH_UP_POLICIES).optional().default("skip_missed"),
  variables: external_exports.array(routineVariableSchema).optional().default([]),
  env: envConfigSchema.optional().nullable()
});
var updateRoutineSchema = createRoutineSchema.partial().extend({
  baseRevisionId: external_exports.string().uuid().optional().nullable()
});
var routineRevisionSnapshotRoutineV1Schema = external_exports.object({
  id: external_exports.string().uuid(),
  companyId: external_exports.string().uuid(),
  projectId: external_exports.string().uuid().nullable(),
  folderId: external_exports.string().uuid().nullable().optional(),
  goalId: external_exports.string().uuid().nullable(),
  parentIssueId: external_exports.string().uuid().nullable(),
  title: external_exports.string().trim().min(1).max(200),
  description: external_exports.string().nullable(),
  assigneeAgentId: external_exports.string().uuid().nullable(),
  priority: external_exports.enum(ISSUE_PRIORITIES),
  status: external_exports.enum(ROUTINE_STATUSES),
  concurrencyPolicy: external_exports.enum(ROUTINE_CONCURRENCY_POLICIES),
  catchUpPolicy: external_exports.enum(ROUTINE_CATCH_UP_POLICIES),
  variables: external_exports.array(routineVariableSchema),
  env: envConfigSchema.nullable().default(null),
  responsibleUserId: external_exports.string().nullable().default(null)
}).strict();
var routineRevisionSnapshotTriggerV1Schema = external_exports.object({
  id: external_exports.string().uuid(),
  kind: external_exports.enum(ROUTINE_TRIGGER_KINDS),
  label: external_exports.string().nullable(),
  enabled: external_exports.boolean(),
  cronExpression: external_exports.string().nullable(),
  timezone: external_exports.string().nullable(),
  publicId: external_exports.string().nullable(),
  signingMode: external_exports.enum(ROUTINE_TRIGGER_SIGNING_MODES).nullable(),
  replayWindowSec: external_exports.number().int().min(30).max(86400).nullable()
}).strict();
var routineRevisionSnapshotV1Schema = external_exports.object({
  version: external_exports.literal(1),
  routine: routineRevisionSnapshotRoutineV1Schema,
  triggers: external_exports.array(routineRevisionSnapshotTriggerV1Schema)
}).strict();
var baseTriggerSchema = external_exports.object({
  label: external_exports.string().trim().max(120).optional().nullable(),
  enabled: external_exports.boolean().optional().default(true)
});
var createRoutineTriggerSchema = external_exports.discriminatedUnion("kind", [
  baseTriggerSchema.extend({
    kind: external_exports.literal("schedule"),
    cronExpression: external_exports.string().trim().min(1),
    timezone: external_exports.string().trim().min(1).default("UTC")
  }),
  baseTriggerSchema.extend({
    kind: external_exports.literal("webhook"),
    signingMode: external_exports.enum(ROUTINE_TRIGGER_SIGNING_MODES).optional().default("bearer"),
    replayWindowSec: external_exports.number().int().min(30).max(86400).optional().default(300)
  }),
  baseTriggerSchema.extend({
    kind: external_exports.literal("api")
  })
]);
var updateRoutineTriggerSchema = external_exports.object({
  label: external_exports.string().trim().max(120).optional().nullable(),
  enabled: external_exports.boolean().optional(),
  cronExpression: external_exports.string().trim().min(1).optional().nullable(),
  timezone: external_exports.string().trim().min(1).optional().nullable(),
  signingMode: external_exports.enum(ROUTINE_TRIGGER_SIGNING_MODES).optional().nullable(),
  replayWindowSec: external_exports.number().int().min(30).max(86400).optional().nullable()
});
var runRoutineSchema = external_exports.object({
  triggerId: external_exports.string().uuid().optional().nullable(),
  payload: external_exports.record(external_exports.string(), external_exports.unknown()).optional().nullable(),
  variables: external_exports.record(external_exports.string(), routineVariableValueSchema).optional().nullable(),
  projectId: external_exports.string().uuid().optional().nullable(),
  projectWorkspaceId: external_exports.string().uuid().optional().nullable(),
  assigneeAgentId: external_exports.string().uuid().optional().nullable(),
  idempotencyKey: external_exports.string().trim().max(255).optional().nullable(),
  source: external_exports.enum(["manual", "api"]).optional().default("manual"),
  executionWorkspaceId: external_exports.string().uuid().optional().nullable(),
  executionWorkspacePreference: external_exports.enum(ISSUE_EXECUTION_WORKSPACE_PREFERENCES).optional().nullable(),
  executionWorkspaceSettings: issueExecutionWorkspaceSettingsSchema.optional().nullable()
});
var rotateRoutineTriggerSecretSchema = external_exports.object({});

// ../../node_modules/.pnpm/@paperclipai+shared@2026.722.0/node_modules/@paperclipai/shared/dist/validators/external-object.js
var externalObjectStatusCategorySchema = external_exports.enum(EXTERNAL_OBJECT_STATUS_CATEGORIES);
var externalObjectStatusToneSchema = external_exports.enum(EXTERNAL_OBJECT_STATUS_TONES);
var externalObjectLivenessStateSchema = external_exports.enum(EXTERNAL_OBJECT_LIVENESS_STATES);
var externalObjectMentionSourceKindSchema = external_exports.enum(EXTERNAL_OBJECT_MENTION_SOURCE_KINDS);
var externalObjectMentionConfidenceSchema = external_exports.enum(EXTERNAL_OBJECT_MENTION_CONFIDENCES);
var externalObjectProviderKeySchema = external_exports.string().trim().min(1).max(80).regex(/^[a-z][a-z0-9_.-]*$/);
var externalObjectTypeSchema = external_exports.string().trim().min(1).max(80).regex(/^[a-z][a-z0-9_]*$/);
var externalObjectCanonicalIdentitySchema = external_exports.object({
  scheme: external_exports.enum(["http", "https"]),
  host: external_exports.string().trim().min(1),
  path: external_exports.string().trim().min(1),
  queryParamHashes: external_exports.record(external_exports.string().regex(/^[a-f0-9]{64}$/)).optional()
}).strict();
var externalObjectMentionSourceSchema = external_exports.object({
  sourceKind: externalObjectMentionSourceKindSchema,
  documentKey: external_exports.string().trim().min(1).optional().nullable(),
  propertyKey: external_exports.string().trim().min(1).optional().nullable()
}).strict();

// ../../node_modules/.pnpm/@paperclipai+shared@2026.722.0/node_modules/@paperclipai/shared/dist/validators/plugin.js
var jsonSchemaSchema = external_exports.record(external_exports.string(), external_exports.unknown()).refine((val) => {
  if (Object.keys(val).length === 0)
    return true;
  return typeof val.type === "string" || val.$ref !== void 0 || val.oneOf !== void 0 || val.anyOf !== void 0 || val.allOf !== void 0;
}, { message: "Must be a valid JSON Schema object (requires at least a 'type', '$ref', or composition keyword)" });
var CRON_FIELD_PATTERN = /^(\*(?:\/[0-9]+)?|[0-9]+(?:-[0-9]+)?(?:\/[0-9]+)?)(?:,(\*(?:\/[0-9]+)?|[0-9]+(?:-[0-9]+)?(?:\/[0-9]+)?))*$/;
function isValidCronExpression(expression) {
  const trimmed = expression.trim();
  if (!trimmed)
    return false;
  const fields = trimmed.split(/\s+/);
  if (fields.length !== 5)
    return false;
  return fields.every((f) => CRON_FIELD_PATTERN.test(f));
}
var pluginJobDeclarationSchema = external_exports.object({
  jobKey: external_exports.string().min(1),
  displayName: external_exports.string().min(1),
  description: external_exports.string().optional(),
  schedule: external_exports.string().refine((val) => isValidCronExpression(val), { message: "schedule must be a valid 5-field cron expression (e.g. '*/15 * * * *')" }).optional()
});
var pluginWebhookDeclarationSchema = external_exports.object({
  endpointKey: external_exports.string().min(1),
  displayName: external_exports.string().min(1),
  description: external_exports.string().optional()
});
var pluginToolDeclarationSchema = external_exports.object({
  name: external_exports.string().min(1),
  displayName: external_exports.string().min(1),
  description: external_exports.string().min(1),
  parametersSchema: jsonSchemaSchema
});
var pluginEnvironmentTemplateConfigFieldSchema = external_exports.string().min(1).max(100).regex(/^[A-Za-z_][A-Za-z0-9_-]*$/, "Template config binding fields must be top-level config keys using letters, digits, underscores, or hyphens").refine((value) => value !== "provider", {
  message: "Template config binding must not replace the sandbox provider key"
});
var pluginEnvironmentTemplateConfigBindingSchema = external_exports.object({
  field: pluginEnvironmentTemplateConfigFieldSchema,
  unsetFields: external_exports.array(pluginEnvironmentTemplateConfigFieldSchema).max(20).optional()
}).strict().superRefine((value, ctx) => {
  const unsetFields = value.unsetFields ?? [];
  const seen = /* @__PURE__ */ new Set();
  for (const [index, field2] of unsetFields.entries()) {
    if (field2 === value.field) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        message: "Template config binding cannot unset the same field it sets",
        path: ["unsetFields", index]
      });
    }
    if (seen.has(field2)) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        message: "Template config binding unsetFields must be unique",
        path: ["unsetFields", index]
      });
    }
    seen.add(field2);
  }
});
var pluginEnvironmentDriverDeclarationSchema = external_exports.object({
  driverKey: external_exports.string().min(1).regex(/^[a-z0-9][a-z0-9._-]*$/, "Environment driver key must start with a lowercase alphanumeric and contain only lowercase letters, digits, dots, hyphens, or underscores"),
  kind: external_exports.enum(["environment_driver", "sandbox_provider"]).optional(),
  displayName: external_exports.string().min(1).max(100),
  description: external_exports.string().max(500).optional(),
  supportsReusableLeases: external_exports.boolean().optional(),
  supportsInteractiveSetup: external_exports.boolean().optional(),
  interactiveSetupConnectionTypes: external_exports.array(external_exports.string().min(1).max(100)).max(10).optional(),
  supportsTemplateCapture: external_exports.boolean().optional(),
  templateRefKind: external_exports.string().min(1).max(100).optional(),
  templateConfigBinding: pluginEnvironmentTemplateConfigBindingSchema.optional(),
  templateIdentityPaths: external_exports.array(external_exports.string().min(1).max(200)).max(20).optional(),
  supportsTemplateDelete: external_exports.boolean().optional(),
  configSchema: jsonSchemaSchema
});
var pluginManagedAgentDeclarationSchema = external_exports.object({
  agentKey: external_exports.string().min(1).max(100).regex(/^[a-z0-9][a-z0-9._:-]*$/, {
    message: "agentKey must start with a lowercase alphanumeric and contain only lowercase letters, digits, dots, colons, underscores, or hyphens"
  }),
  displayName: external_exports.string().min(1).max(100),
  role: external_exports.string().min(1).max(100).optional(),
  title: external_exports.string().max(200).nullable().optional(),
  icon: external_exports.string().max(100).nullable().optional(),
  capabilities: external_exports.string().max(2e3).nullable().optional(),
  adapterType: external_exports.string().min(1).max(100).optional(),
  adapterPreference: external_exports.array(external_exports.string().min(1).max(100)).max(10).optional(),
  adapterConfig: external_exports.record(external_exports.string(), external_exports.unknown()).optional(),
  runtimeConfig: external_exports.record(external_exports.string(), external_exports.unknown()).optional(),
  permissions: external_exports.record(external_exports.string(), external_exports.unknown()).optional(),
  status: external_exports.enum(["idle", "paused"]).optional(),
  budgetMonthlyCents: external_exports.number().int().min(0).optional(),
  instructions: external_exports.object({
    entryFile: external_exports.string().min(1).max(200).optional(),
    content: external_exports.string().max(2e5).optional(),
    files: external_exports.record(external_exports.string().max(2e5)).optional(),
    assetPath: external_exports.string().min(1).max(500).optional()
  }).optional()
});
var pluginManagedProjectDeclarationSchema = external_exports.object({
  projectKey: external_exports.string().min(1).max(100).regex(/^[a-z0-9][a-z0-9._:-]*$/, {
    message: "projectKey must start with a lowercase alphanumeric and contain only lowercase letters, digits, dots, colons, underscores, or hyphens"
  }),
  displayName: external_exports.string().min(1).max(120),
  description: external_exports.string().max(2e3).nullable().optional(),
  status: external_exports.enum(["backlog", "planned", "in_progress", "completed", "cancelled"]).optional(),
  color: external_exports.string().max(32).nullable().optional(),
  settings: external_exports.record(external_exports.string(), external_exports.unknown()).optional()
});
var pluginManagedResourceRefSchema = external_exports.object({
  pluginKey: external_exports.string().min(1).max(100).optional(),
  resourceKind: external_exports.enum(["agent", "project", "routine", "skill"]),
  resourceKey: external_exports.string().min(1).max(100).regex(/^[a-z0-9][a-z0-9._:-]*$/, {
    message: "resourceKey must start with a lowercase alphanumeric and contain only lowercase letters, digits, dots, colons, underscores, or hyphens"
  })
});
var pluginManagedRoutineDeclarationSchema = external_exports.object({
  routineKey: external_exports.string().min(1).max(100).regex(/^[a-z0-9][a-z0-9._:-]*$/, {
    message: "routineKey must start with a lowercase alphanumeric and contain only lowercase letters, digits, dots, colons, underscores, or hyphens"
  }),
  title: external_exports.string().trim().min(1).max(200),
  description: external_exports.string().max(1e4).nullable().optional(),
  assigneeRef: pluginManagedResourceRefSchema.extend({ resourceKind: external_exports.literal("agent") }).nullable().optional(),
  projectRef: pluginManagedResourceRefSchema.extend({ resourceKind: external_exports.literal("project") }).nullable().optional(),
  goalId: external_exports.string().uuid().nullable().optional(),
  status: external_exports.enum(ROUTINE_STATUSES).optional(),
  priority: external_exports.enum(ISSUE_PRIORITIES).optional(),
  concurrencyPolicy: external_exports.enum(ROUTINE_CONCURRENCY_POLICIES).optional(),
  catchUpPolicy: external_exports.enum(ROUTINE_CATCH_UP_POLICIES).optional(),
  variables: external_exports.array(routineVariableSchema).optional(),
  triggers: external_exports.array(external_exports.object({
    kind: external_exports.enum(ROUTINE_TRIGGER_KINDS),
    label: external_exports.string().trim().max(120).nullable().optional(),
    enabled: external_exports.boolean().optional(),
    cronExpression: external_exports.string().trim().min(1).optional().nullable(),
    timezone: external_exports.string().trim().min(1).optional().nullable(),
    signingMode: external_exports.enum(ROUTINE_TRIGGER_SIGNING_MODES).optional().nullable(),
    replayWindowSec: external_exports.number().int().min(30).max(86400).optional().nullable()
  })).max(20).optional(),
  issueTemplate: external_exports.object({
    surfaceVisibility: external_exports.enum(ISSUE_SURFACE_VISIBILITIES).optional(),
    originId: external_exports.string().trim().max(255).nullable().optional(),
    billingCode: external_exports.string().trim().max(200).nullable().optional()
  }).optional()
});
var pluginLocalFolderRelativePathSchema = external_exports.string().min(1).max(500).refine((value) => !value.startsWith("/") && !value.includes("..") && !value.includes("\\") && !value.split("/").some((segment) => segment === "" || segment === "."), { message: "local folder paths must be relative paths without traversal, empty segments, or backslashes" });
var pluginLocalFolderDeclarationSchema = external_exports.object({
  folderKey: external_exports.string().min(1).max(100).regex(/^[a-z0-9][a-z0-9._:-]*$/, {
    message: "folderKey must start with a lowercase alphanumeric and contain only lowercase letters, digits, dots, colons, underscores, or hyphens"
  }),
  displayName: external_exports.string().min(1).max(100),
  description: external_exports.string().max(500).optional(),
  access: external_exports.enum(["read", "readWrite"]).optional(),
  requiredDirectories: external_exports.array(pluginLocalFolderRelativePathSchema).optional(),
  requiredFiles: external_exports.array(pluginLocalFolderRelativePathSchema).optional()
});
var pluginManagedSkillFileDeclarationSchema = external_exports.object({
  path: pluginLocalFolderRelativePathSchema.refine((value) => value.toLowerCase() !== "skill.md", { message: "managed skill files cannot replace SKILL.md; use markdown for the main skill file" }),
  content: external_exports.string().max(2e5)
});
var pluginManagedSkillDeclarationSchema = external_exports.object({
  skillKey: external_exports.string().min(1).max(100).regex(/^[a-z0-9][a-z0-9._:-]*$/, {
    message: "skillKey must start with a lowercase alphanumeric and contain only lowercase letters, digits, dots, colons, underscores, or hyphens"
  }),
  displayName: external_exports.string().min(1).max(100),
  slug: external_exports.string().min(1).max(100).regex(/^[a-z0-9][a-z0-9._:-]*$/, {
    message: "slug must start with a lowercase alphanumeric and contain only lowercase letters, digits, dots, colons, underscores, or hyphens"
  }).optional(),
  description: external_exports.string().max(2e3).nullable().optional(),
  markdown: external_exports.string().max(2e5).optional(),
  files: external_exports.array(pluginManagedSkillFileDeclarationSchema).max(50).optional()
}).superRefine((value, ctx) => {
  const paths = (value.files ?? []).map((file) => file.path);
  const duplicates = paths.filter((path2, index) => paths.indexOf(path2) !== index);
  if (duplicates.length > 0) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      message: `Duplicate managed skill file paths: ${[...new Set(duplicates)].join(", ")}`,
      path: ["files"]
    });
  }
});
var pluginUiSlotDeclarationSchema = external_exports.object({
  type: external_exports.enum(PLUGIN_UI_SLOT_TYPES),
  id: external_exports.string().min(1),
  displayName: external_exports.string().min(1),
  exportName: external_exports.string().min(1),
  entityTypes: external_exports.array(external_exports.enum(PLUGIN_UI_SLOT_ENTITY_TYPES)).optional(),
  routePath: external_exports.string().regex(/^[a-z0-9][a-z0-9-]*$/, {
    message: "routePath must be a lowercase single-segment slug (letters, numbers, hyphens)"
  }).optional(),
  order: external_exports.number().int().optional()
}).superRefine((value, ctx) => {
  const entityScopedTypes = ["detailTab", "taskDetailView", "contextMenuItem", "commentAnnotation", "commentContextMenuItem", "projectSidebarItem"];
  if (entityScopedTypes.includes(value.type) && (!value.entityTypes || value.entityTypes.length === 0)) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      message: `${value.type} slots require at least one entityType`,
      path: ["entityTypes"]
    });
  }
  if (value.type === "projectSidebarItem" && value.entityTypes && !value.entityTypes.includes("project")) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      message: 'projectSidebarItem slots require entityTypes to include "project"',
      path: ["entityTypes"]
    });
  }
  if (value.type === "commentAnnotation" && value.entityTypes && !value.entityTypes.includes("comment")) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      message: 'commentAnnotation slots require entityTypes to include "comment"',
      path: ["entityTypes"]
    });
  }
  if (value.type === "commentContextMenuItem" && value.entityTypes && !value.entityTypes.includes("comment")) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      message: 'commentContextMenuItem slots require entityTypes to include "comment"',
      path: ["entityTypes"]
    });
  }
  if (value.routePath && value.type !== "page" && value.type !== "routeSidebar" && value.type !== "companySettingsPage") {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      message: "routePath is only supported for page, routeSidebar, and companySettingsPage slots",
      path: ["routePath"]
    });
  }
  if (value.type === "routeSidebar" && !value.routePath) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      message: "routeSidebar slots require routePath",
      path: ["routePath"]
    });
  }
  if (value.type === "companySettingsPage" && !value.routePath) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      message: "companySettingsPage slots require routePath",
      path: ["routePath"]
    });
  }
  if (value.routePath && PLUGIN_RESERVED_COMPANY_ROUTE_SEGMENTS.includes(value.routePath)) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      message: `routePath "${value.routePath}" is reserved by the host`,
      path: ["routePath"]
    });
  }
  if (value.type === "companySettingsPage" && value.routePath && PLUGIN_RESERVED_COMPANY_SETTINGS_ROUTE_SEGMENTS.includes(value.routePath)) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      message: `company settings routePath "${value.routePath}" is reserved by the host`,
      path: ["routePath"]
    });
  }
});
var entityScopedLauncherPlacementZones = [
  "detailTab",
  "taskDetailView",
  "contextMenuItem",
  "commentAnnotation",
  "commentContextMenuItem",
  "projectSidebarItem"
];
var launcherBoundsByEnvironment = {
  hostInline: ["inline", "compact", "default"],
  hostOverlay: ["compact", "default", "wide", "full"],
  hostRoute: ["default", "wide", "full"],
  external: [],
  iframe: ["compact", "default", "wide", "full"]
};
var pluginLauncherActionDeclarationSchema = external_exports.object({
  type: external_exports.enum(PLUGIN_LAUNCHER_ACTIONS),
  target: external_exports.string().min(1),
  params: external_exports.record(external_exports.string(), external_exports.unknown()).optional()
}).superRefine((value, ctx) => {
  if (value.type === "performAction" && value.target.includes("/")) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      message: "performAction launchers must target an action key, not a route or URL",
      path: ["target"]
    });
  }
  if (value.type === "navigate" && /^https?:\/\//.test(value.target)) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      message: "navigate launchers must target a host route, not an absolute URL",
      path: ["target"]
    });
  }
});
var pluginLauncherRenderDeclarationSchema = external_exports.object({
  environment: external_exports.enum(PLUGIN_LAUNCHER_RENDER_ENVIRONMENTS),
  bounds: external_exports.enum(PLUGIN_LAUNCHER_BOUNDS).optional()
}).superRefine((value, ctx) => {
  if (!value.bounds) {
    return;
  }
  const supportedBounds = launcherBoundsByEnvironment[value.environment];
  if (!supportedBounds.includes(value.bounds)) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      message: `bounds "${value.bounds}" is not supported for render environment "${value.environment}"`,
      path: ["bounds"]
    });
  }
});
var pluginLauncherDeclarationSchema = external_exports.object({
  id: external_exports.string().min(1),
  displayName: external_exports.string().min(1),
  description: external_exports.string().optional(),
  placementZone: external_exports.enum(PLUGIN_LAUNCHER_PLACEMENT_ZONES),
  exportName: external_exports.string().min(1).optional(),
  entityTypes: external_exports.array(external_exports.enum(PLUGIN_UI_SLOT_ENTITY_TYPES)).optional(),
  order: external_exports.number().int().optional(),
  action: pluginLauncherActionDeclarationSchema,
  render: pluginLauncherRenderDeclarationSchema.optional()
}).superRefine((value, ctx) => {
  if (entityScopedLauncherPlacementZones.some((zone) => zone === value.placementZone) && (!value.entityTypes || value.entityTypes.length === 0)) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      message: `${value.placementZone} launchers require at least one entityType`,
      path: ["entityTypes"]
    });
  }
  if (value.placementZone === "projectSidebarItem" && value.entityTypes && !value.entityTypes.includes("project")) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      message: 'projectSidebarItem launchers require entityTypes to include "project"',
      path: ["entityTypes"]
    });
  }
  if (value.action.type === "performAction" && value.render) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      message: "performAction launchers cannot declare render hints",
      path: ["render"]
    });
  }
  if (["openModal", "openDrawer", "openPopover"].includes(value.action.type) && !value.render) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      message: `${value.action.type} launchers require render metadata`,
      path: ["render"]
    });
  }
  if (value.action.type === "openModal" && value.render?.environment === "hostInline") {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      message: "openModal launchers cannot use the hostInline render environment",
      path: ["render", "environment"]
    });
  }
  if (value.action.type === "openDrawer" && value.render && !["hostOverlay", "iframe"].includes(value.render.environment)) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      message: "openDrawer launchers must use hostOverlay or iframe render environments",
      path: ["render", "environment"]
    });
  }
  if (value.action.type === "openPopover" && value.render?.environment === "hostRoute") {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      message: "openPopover launchers cannot use the hostRoute render environment",
      path: ["render", "environment"]
    });
  }
});
var pluginDatabaseDeclarationSchema = external_exports.object({
  namespaceSlug: external_exports.string().regex(/^[a-z0-9][a-z0-9_]*$/, {
    message: "namespaceSlug must be lowercase letters, digits, or underscores and start with a letter or digit"
  }).max(40).optional(),
  migrationsDir: external_exports.string().min(1).refine((value) => !value.startsWith("/") && !value.includes("..") && !/[\\]/.test(value), { message: "migrationsDir must be a relative package path without '..' or backslashes" }),
  coreReadTables: external_exports.array(external_exports.enum(PLUGIN_DATABASE_CORE_READ_TABLES)).optional()
});
var pluginApiRouteDeclarationSchema = external_exports.object({
  routeKey: external_exports.string().min(1).max(100).regex(/^[a-z0-9][a-z0-9._:-]*$/, {
    message: "routeKey must be lowercase letters, digits, dots, colons, underscores, or hyphens"
  }),
  method: external_exports.enum(PLUGIN_API_ROUTE_METHODS),
  path: external_exports.string().min(1).regex(/^\/[a-zA-Z0-9:_./-]*$/, {
    message: "path must start with / and contain only path-safe literal or :param segments"
  }).refine((value) => !value.includes("..") && !value.includes("//") && value !== "/api" && !value.startsWith("/api/") && value !== "/plugins" && !value.startsWith("/plugins/"), { message: "path must stay inside the plugin api namespace" }),
  auth: external_exports.enum(PLUGIN_API_ROUTE_AUTH_MODES),
  capability: external_exports.literal("api.routes.register"),
  checkoutPolicy: external_exports.enum(PLUGIN_API_ROUTE_CHECKOUT_POLICIES).optional(),
  companyResolution: external_exports.discriminatedUnion("from", [
    external_exports.object({ from: external_exports.literal("body"), key: external_exports.string().min(1) }),
    external_exports.object({ from: external_exports.literal("query"), key: external_exports.string().min(1) }),
    external_exports.object({ from: external_exports.literal("issue"), param: external_exports.string().min(1) })
  ]).optional()
});
var pluginObjectReferenceRefreshPolicySchema = external_exports.object({
  defaultTtlSeconds: external_exports.number().int().positive().max(86400).optional(),
  staleAfterSeconds: external_exports.number().int().positive().max(604800).optional()
}).superRefine((value, ctx) => {
  if (value.defaultTtlSeconds != null && value.staleAfterSeconds != null && value.staleAfterSeconds < value.defaultTtlSeconds) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      message: "staleAfterSeconds must be greater than or equal to defaultTtlSeconds",
      path: ["staleAfterSeconds"]
    });
  }
});
var pluginObjectReferenceProviderDeclarationSchema = external_exports.object({
  providerKey: externalObjectProviderKeySchema,
  displayName: external_exports.string().min(1).max(100),
  objectTypes: external_exports.array(externalObjectTypeSchema).min(1),
  urlPatterns: external_exports.array(external_exports.string().trim().min(1).max(500)).optional(),
  refreshPolicy: pluginObjectReferenceRefreshPolicySchema.optional(),
  webhookEndpointKeys: external_exports.array(external_exports.string().min(1)).optional()
}).superRefine((value, ctx) => {
  const duplicateObjectTypes = value.objectTypes.filter((type, i) => value.objectTypes.indexOf(type) !== i);
  if (duplicateObjectTypes.length > 0) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      message: `Duplicate objectTypes: ${[...new Set(duplicateObjectTypes)].join(", ")}`,
      path: ["objectTypes"]
    });
  }
  const webhookKeys = value.webhookEndpointKeys ?? [];
  const duplicateWebhookKeys = webhookKeys.filter((key, i) => webhookKeys.indexOf(key) !== i);
  if (duplicateWebhookKeys.length > 0) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      message: `Duplicate webhookEndpointKeys: ${[...new Set(duplicateWebhookKeys)].join(", ")}`,
      path: ["webhookEndpointKeys"]
    });
  }
});
var pluginManifestV1Schema = external_exports.object({
  id: external_exports.string().min(1).regex(/^[a-z0-9][a-z0-9._-]*$/, "Plugin id must start with a lowercase alphanumeric and contain only lowercase letters, digits, dots, hyphens, or underscores"),
  apiVersion: external_exports.literal(1),
  version: external_exports.string().min(1).regex(/^\d+\.\d+\.\d+(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/, "Version must follow semver (e.g. 1.0.0 or 1.0.0-beta.1)"),
  displayName: external_exports.string().min(1).max(100),
  description: external_exports.string().min(1).max(500),
  author: external_exports.string().min(1).max(200),
  categories: external_exports.array(external_exports.enum(PLUGIN_CATEGORIES)).min(1),
  minimumHostVersion: external_exports.string().regex(/^\d+\.\d+\.\d+(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/, "minimumHostVersion must follow semver (e.g. 1.0.0)").optional(),
  minimumPaperclipVersion: external_exports.string().regex(/^\d+\.\d+\.\d+(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/, "minimumPaperclipVersion must follow semver (e.g. 1.0.0)").optional(),
  capabilities: external_exports.array(external_exports.enum(PLUGIN_CAPABILITIES)).min(1),
  entrypoints: external_exports.object({
    worker: external_exports.string().min(1),
    ui: external_exports.string().min(1).optional()
  }),
  instanceConfigSchema: jsonSchemaSchema.optional(),
  jobs: external_exports.array(pluginJobDeclarationSchema).optional(),
  webhooks: external_exports.array(pluginWebhookDeclarationSchema).optional(),
  tools: external_exports.array(pluginToolDeclarationSchema).optional(),
  database: pluginDatabaseDeclarationSchema.optional(),
  apiRoutes: external_exports.array(pluginApiRouteDeclarationSchema).optional(),
  environmentDrivers: external_exports.array(pluginEnvironmentDriverDeclarationSchema).optional(),
  agents: external_exports.array(pluginManagedAgentDeclarationSchema).optional(),
  projects: external_exports.array(pluginManagedProjectDeclarationSchema).optional(),
  routines: external_exports.array(pluginManagedRoutineDeclarationSchema).optional(),
  skills: external_exports.array(pluginManagedSkillDeclarationSchema).optional(),
  localFolders: external_exports.array(pluginLocalFolderDeclarationSchema).optional(),
  objectReferences: external_exports.array(pluginObjectReferenceProviderDeclarationSchema).optional(),
  launchers: external_exports.array(pluginLauncherDeclarationSchema).optional(),
  ui: external_exports.object({
    slots: external_exports.array(pluginUiSlotDeclarationSchema).min(1).optional(),
    launchers: external_exports.array(pluginLauncherDeclarationSchema).optional()
  }).optional()
}).superRefine((manifest, ctx) => {
  const hasUiSlots = (manifest.ui?.slots?.length ?? 0) > 0;
  const hasUiLaunchers = (manifest.ui?.launchers?.length ?? 0) > 0;
  if ((hasUiSlots || hasUiLaunchers) && !manifest.entrypoints.ui) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      message: "entrypoints.ui is required when ui.slots or ui.launchers are declared",
      path: ["entrypoints", "ui"]
    });
  }
  if (manifest.minimumHostVersion && manifest.minimumPaperclipVersion && manifest.minimumHostVersion !== manifest.minimumPaperclipVersion) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      message: "minimumHostVersion and minimumPaperclipVersion must match when both are declared",
      path: ["minimumHostVersion"]
    });
  }
  if (manifest.tools && manifest.tools.length > 0) {
    if (!manifest.capabilities.includes("agent.tools.register")) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        message: "Capability 'agent.tools.register' is required when tools are declared",
        path: ["capabilities"]
      });
    }
  }
  if (manifest.environmentDrivers && manifest.environmentDrivers.length > 0) {
    if (!manifest.capabilities.includes("environment.drivers.register")) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        message: "Capability 'environment.drivers.register' is required when environmentDrivers are declared",
        path: ["capabilities"]
      });
    }
  }
  if (manifest.agents && manifest.agents.length > 0) {
    if (!manifest.capabilities.includes("agents.managed")) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        message: "Capability 'agents.managed' is required when managed agents are declared",
        path: ["capabilities"]
      });
    }
  }
  if (manifest.projects && manifest.projects.length > 0) {
    if (!manifest.capabilities.includes("projects.managed")) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        message: "Capability 'projects.managed' is required when managed projects are declared",
        path: ["capabilities"]
      });
    }
  }
  if (manifest.routines && manifest.routines.length > 0) {
    if (!manifest.capabilities.includes("routines.managed")) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        message: "Capability 'routines.managed' is required when managed routines are declared",
        path: ["capabilities"]
      });
    }
  }
  if (manifest.skills && manifest.skills.length > 0) {
    if (!manifest.capabilities.includes("skills.managed")) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        message: "Capability 'skills.managed' is required when managed skills are declared",
        path: ["capabilities"]
      });
    }
  }
  if (manifest.localFolders && manifest.localFolders.length > 0) {
    if (!manifest.capabilities.includes("local.folders")) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        message: "Capability 'local.folders' is required when local folders are declared",
        path: ["capabilities"]
      });
    }
  }
  if (manifest.jobs && manifest.jobs.length > 0) {
    if (!manifest.capabilities.includes("jobs.schedule")) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        message: "Capability 'jobs.schedule' is required when jobs are declared",
        path: ["capabilities"]
      });
    }
  }
  if (manifest.webhooks && manifest.webhooks.length > 0) {
    if (!manifest.capabilities.includes("webhooks.receive")) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        message: "Capability 'webhooks.receive' is required when webhooks are declared",
        path: ["capabilities"]
      });
    }
  }
  if (manifest.apiRoutes && manifest.apiRoutes.length > 0) {
    if (!manifest.capabilities.includes("api.routes.register")) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        message: "Capability 'api.routes.register' is required when apiRoutes are declared",
        path: ["capabilities"]
      });
    }
  }
  if (manifest.objectReferences && manifest.objectReferences.length > 0) {
    for (const capability of ["external.objects.detect", "external.objects.read"]) {
      if (!manifest.capabilities.includes(capability)) {
        ctx.addIssue({
          code: external_exports.ZodIssueCode.custom,
          message: `Capability '${capability}' is required when objectReferences are declared`,
          path: ["capabilities"]
        });
      }
    }
    const declaredWebhookKeys = new Set((manifest.webhooks ?? []).map((webhook) => webhook.endpointKey));
    for (const [providerIndex, provider] of manifest.objectReferences.entries()) {
      for (const endpointKey of provider.webhookEndpointKeys ?? []) {
        if (!declaredWebhookKeys.has(endpointKey)) {
          ctx.addIssue({
            code: external_exports.ZodIssueCode.custom,
            message: `objectReferences webhookEndpointKey "${endpointKey}" must match a declared webhook endpoint`,
            path: ["objectReferences", providerIndex, "webhookEndpointKeys"]
          });
        }
      }
    }
  }
  if (manifest.database) {
    const requiredCapabilities = [
      "database.namespace.migrate",
      "database.namespace.read"
    ];
    for (const capability of requiredCapabilities) {
      if (!manifest.capabilities.includes(capability)) {
        ctx.addIssue({
          code: external_exports.ZodIssueCode.custom,
          message: `Capability '${capability}' is required when database migrations are declared`,
          path: ["capabilities"]
        });
      }
    }
    const coreReadTables = manifest.database.coreReadTables ?? [];
    const duplicates = coreReadTables.filter((table, i) => coreReadTables.indexOf(table) !== i);
    if (duplicates.length > 0) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        message: `Duplicate database coreReadTables: ${[...new Set(duplicates)].join(", ")}`,
        path: ["database", "coreReadTables"]
      });
    }
  }
  if (manifest.jobs) {
    const jobKeys = manifest.jobs.map((j) => j.jobKey);
    const duplicates = jobKeys.filter((key, i) => jobKeys.indexOf(key) !== i);
    if (duplicates.length > 0) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        message: `Duplicate job keys: ${[...new Set(duplicates)].join(", ")}`,
        path: ["jobs"]
      });
    }
  }
  if (manifest.webhooks) {
    const endpointKeys = manifest.webhooks.map((w) => w.endpointKey);
    const duplicates = endpointKeys.filter((key, i) => endpointKeys.indexOf(key) !== i);
    if (duplicates.length > 0) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        message: `Duplicate webhook endpoint keys: ${[...new Set(duplicates)].join(", ")}`,
        path: ["webhooks"]
      });
    }
  }
  if (manifest.apiRoutes) {
    const routeKeys = manifest.apiRoutes.map((route) => route.routeKey);
    const duplicateKeys = routeKeys.filter((key, i) => routeKeys.indexOf(key) !== i);
    if (duplicateKeys.length > 0) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        message: `Duplicate api route keys: ${[...new Set(duplicateKeys)].join(", ")}`,
        path: ["apiRoutes"]
      });
    }
    const routeSignatures = manifest.apiRoutes.map((route) => `${route.method} ${route.path}`);
    const duplicateRoutes = routeSignatures.filter((sig, i) => routeSignatures.indexOf(sig) !== i);
    if (duplicateRoutes.length > 0) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        message: `Duplicate api routes: ${[...new Set(duplicateRoutes)].join(", ")}`,
        path: ["apiRoutes"]
      });
    }
  }
  if (manifest.tools) {
    const toolNames = manifest.tools.map((t) => t.name);
    const duplicates = toolNames.filter((name, i) => toolNames.indexOf(name) !== i);
    if (duplicates.length > 0) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        message: `Duplicate tool names: ${[...new Set(duplicates)].join(", ")}`,
        path: ["tools"]
      });
    }
  }
  if (manifest.environmentDrivers) {
    const driverKeys = manifest.environmentDrivers.map((d) => d.driverKey);
    const duplicates = driverKeys.filter((key, i) => driverKeys.indexOf(key) !== i);
    if (duplicates.length > 0) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        message: `Duplicate environment driver keys: ${[...new Set(duplicates)].join(", ")}`,
        path: ["environmentDrivers"]
      });
    }
  }
  if (manifest.localFolders) {
    const folderKeys = manifest.localFolders.map((folder) => folder.folderKey);
    const duplicates = folderKeys.filter((key, i) => folderKeys.indexOf(key) !== i);
    if (duplicates.length > 0) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        message: `Duplicate local folder keys: ${[...new Set(duplicates)].join(", ")}`,
        path: ["localFolders"]
      });
    }
  }
  if (manifest.agents) {
    const agentKeys = manifest.agents.map((agent) => agent.agentKey);
    const duplicates = agentKeys.filter((key, i) => agentKeys.indexOf(key) !== i);
    if (duplicates.length > 0) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        message: `Duplicate managed agent keys: ${[...new Set(duplicates)].join(", ")}`,
        path: ["agents"]
      });
    }
  }
  if (manifest.projects) {
    const projectKeys = manifest.projects.map((project) => project.projectKey);
    const duplicates = projectKeys.filter((key, i) => projectKeys.indexOf(key) !== i);
    if (duplicates.length > 0) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        message: `Duplicate managed project keys: ${[...new Set(duplicates)].join(", ")}`,
        path: ["projects"]
      });
    }
  }
  if (manifest.routines) {
    const routineKeys = manifest.routines.map((routine) => routine.routineKey);
    const duplicates = routineKeys.filter((key, i) => routineKeys.indexOf(key) !== i);
    if (duplicates.length > 0) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        message: `Duplicate managed routine keys: ${[...new Set(duplicates)].join(", ")}`,
        path: ["routines"]
      });
    }
  }
  if (manifest.skills) {
    const skillKeys = manifest.skills.map((skill) => skill.skillKey);
    const duplicates = skillKeys.filter((key, i) => skillKeys.indexOf(key) !== i);
    if (duplicates.length > 0) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        message: `Duplicate managed skill keys: ${[...new Set(duplicates)].join(", ")}`,
        path: ["skills"]
      });
    }
  }
  if (manifest.objectReferences) {
    const providerKeys = manifest.objectReferences.map((provider) => provider.providerKey);
    const duplicateProviders = providerKeys.filter((key, i) => providerKeys.indexOf(key) !== i);
    if (duplicateProviders.length > 0) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        message: `Duplicate object reference provider keys: ${[...new Set(duplicateProviders)].join(", ")}`,
        path: ["objectReferences"]
      });
    }
  }
  if (manifest.ui) {
    if (manifest.ui.slots) {
      const slotIds = manifest.ui.slots.map((s) => s.id);
      const duplicates = slotIds.filter((id, i) => slotIds.indexOf(id) !== i);
      if (duplicates.length > 0) {
        ctx.addIssue({
          code: external_exports.ZodIssueCode.custom,
          message: `Duplicate UI slot ids: ${[...new Set(duplicates)].join(", ")}`,
          path: ["ui", "slots"]
        });
      }
    }
  }
  const allLaunchers = [
    ...manifest.launchers ?? [],
    ...manifest.ui?.launchers ?? []
  ];
  if (allLaunchers.length > 0) {
    const launcherIds = allLaunchers.map((launcher) => launcher.id);
    const duplicates = launcherIds.filter((id, i) => launcherIds.indexOf(id) !== i);
    if (duplicates.length > 0) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        message: `Duplicate launcher ids: ${[...new Set(duplicates)].join(", ")}`,
        path: manifest.ui?.launchers ? ["ui", "launchers"] : ["launchers"]
      });
    }
  }
});
var installPluginSchema = external_exports.object({
  packageName: external_exports.string().min(1),
  version: external_exports.string().min(1).optional(),
  /** Set by loader for local-path installs so the worker can be resolved. */
  packagePath: external_exports.string().min(1).optional()
});
var upsertPluginConfigSchema = external_exports.object({
  companyId: external_exports.string().uuid(),
  configJson: external_exports.record(external_exports.string(), external_exports.unknown())
});
var patchPluginConfigSchema = external_exports.object({
  companyId: external_exports.string().uuid(),
  configJson: external_exports.record(external_exports.string(), external_exports.unknown())
});
var updatePluginStatusSchema = external_exports.object({
  status: external_exports.enum(PLUGIN_STATUSES),
  lastError: external_exports.string().nullable().optional()
});
var uninstallPluginSchema = external_exports.object({
  removeData: external_exports.boolean().optional().default(false)
});
var pluginStateScopeKeySchema = external_exports.object({
  scopeKind: external_exports.enum(PLUGIN_STATE_SCOPE_KINDS),
  scopeId: external_exports.string().min(1).optional(),
  namespace: external_exports.string().min(1).optional(),
  stateKey: external_exports.string().min(1)
});
var setPluginStateSchema = external_exports.object({
  scopeKind: external_exports.enum(PLUGIN_STATE_SCOPE_KINDS),
  scopeId: external_exports.string().min(1).optional(),
  namespace: external_exports.string().min(1).optional(),
  stateKey: external_exports.string().min(1),
  /** JSON-serializable value to store. */
  value: external_exports.unknown()
});
var listPluginStateSchema = external_exports.object({
  scopeKind: external_exports.enum(PLUGIN_STATE_SCOPE_KINDS).optional(),
  scopeId: external_exports.string().min(1).optional(),
  namespace: external_exports.string().min(1).optional()
});

// ../../node_modules/.pnpm/@paperclipai+shared@2026.722.0/node_modules/@paperclipai/shared/dist/validators/tool-access.js
var toolApplicationTypeSchema = external_exports.enum(TOOL_APPLICATION_TYPES);
var toolApplicationStatusSchema = external_exports.enum(TOOL_APPLICATION_STATUSES);
var toolConnectionTransportSchema = external_exports.enum(["mcp_remote", "rest_api", "local_stdio"]);
var toolConnectionAuthKindSchema = external_exports.enum(["oauth", "api_key", "none"]);
var toolConnectionOwnershipSchema = external_exports.enum(["platform_shared", "platform_provisioned", "customer", "dcr"]);
var connectionGrantKindSchema = external_exports.enum(["workspace", "user"]);
var connectionGrantStatusSchema = external_exports.enum(["active", "revoked", "expired", "needs_reauthorization"]);
var toolConnectionStatusSchema = external_exports.enum(["draft", "active", "disabled", "archived"]);
var toolConnectionInstallTargetTypeSchema = external_exports.enum(["company", "agent"]);
var toolCredentialPlacementSchema = external_exports.enum(["header", "env"]);
var toolConnectionKindSchema = external_exports.enum(TOOL_CONNECTION_KINDS);
var toolConnectionHealthStatusSchema = external_exports.enum(TOOL_CONNECTION_HEALTH_STATUSES);
var toolCatalogEntryKindSchema = external_exports.enum(TOOL_CATALOG_ENTRY_KINDS);
var toolCatalogEntryStatusSchema = external_exports.enum(TOOL_CATALOG_ENTRY_STATUSES);
var toolRiskLevelSchema = external_exports.enum(TOOL_RISK_LEVELS);
var toolProfileStatusSchema = external_exports.enum(TOOL_PROFILE_STATUSES);
var toolProfileDefaultActionSchema = external_exports.enum(TOOL_PROFILE_DEFAULT_ACTIONS);
var toolProfileEntrySelectorTypeSchema = external_exports.enum(TOOL_PROFILE_ENTRY_SELECTOR_TYPES);
var toolProfileEntryEffectSchema = external_exports.enum(TOOL_PROFILE_ENTRY_EFFECTS);
var toolProfileBindingTargetTypeSchema = external_exports.enum(TOOL_PROFILE_BINDING_TARGET_TYPES);
var toolPolicyTypeSchema = external_exports.enum(TOOL_POLICY_TYPES);
var toolPolicyDecisionSchema = external_exports.enum(TOOL_POLICY_DECISIONS);
var toolInvocationStatusSchema = external_exports.enum(TOOL_INVOCATION_STATUSES);
var toolInvocationApprovalStateSchema = external_exports.enum(TOOL_INVOCATION_APPROVAL_STATES);
var toolMcpGatewayStatusSchema = external_exports.enum(TOOL_MCP_GATEWAY_STATUSES);
var toolMcpGatewayDefaultProfileModeSchema = external_exports.enum(TOOL_MCP_GATEWAY_DEFAULT_PROFILE_MODES);
var toolMcpGatewayContextScopeTypeSchema = external_exports.enum(TOOL_MCP_GATEWAY_CONTEXT_SCOPE_TYPES);
var toolMcpGatewayTokenSubjectTypeSchema = external_exports.enum(TOOL_MCP_GATEWAY_TOKEN_SUBJECT_TYPES);
var toolMcpGatewayTokenActionSchema = external_exports.enum(TOOL_MCP_GATEWAY_TOKEN_ACTIONS);
var toolActionRequestStatusSchema = external_exports.enum(TOOL_ACTION_REQUEST_STATUSES);
var toolAuditEventTypeSchema = external_exports.enum(TOOL_AUDIT_EVENT_TYPES);
var toolAuditOutcomeSchema = external_exports.enum(TOOL_AUDIT_OUTCOMES);
var toolRuntimeKindSchema = external_exports.enum(TOOL_RUNTIME_KINDS);
var toolRuntimeSlotStatusSchema = external_exports.enum(TOOL_RUNTIME_SLOT_STATUSES);
var toolRateLimitWindowKindSchema = external_exports.enum(TOOL_RATE_LIMIT_WINDOW_KINDS);
var safeKeyPattern = /^[a-z0-9][a-z0-9._:-]*$/i;
var sensitiveConfigKeyPattern = /^(access[-_]?key([-_]?id)?|api[-_]?key|authorization|bearer|client[-_]?secret|credential|credentials|jwt|password|passwd|private[-_]?key|refresh[-_]?token|secret|secret[-_]?access[-_]?key|secret[-_]?key|session[-_]?token|token)$/i;
function rejectSensitiveConfigKeys(value, ctx, path2 = []) {
  if (!value || typeof value !== "object")
    return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectSensitiveConfigKeys(entry, ctx, [...path2, index]));
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (sensitiveConfigKeyPattern.test(key)) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        path: [...path2, key],
        message: `Tool access config cannot persist sensitive field: ${key}. Use credentialSecretRefs instead.`
      });
    }
    rejectSensitiveConfigKeys(nested, ctx, [...path2, key]);
  }
}
var toolCredentialSecretRefSchema = external_exports.object({
  secretId: external_exports.string().uuid(),
  versionSelector: external_exports.union([external_exports.literal("latest"), external_exports.number().int().positive()]).optional(),
  configPath: external_exports.string().trim().min(1).max(200),
  required: external_exports.boolean().optional(),
  label: external_exports.string().trim().max(120).optional().nullable(),
  projectionClass: external_exports.enum(SECRET_PROJECTION_CLASSES).optional(),
  projectionAllowlistKey: external_exports.string().trim().min(1).max(160).optional().nullable(),
  keyScope: external_exports.string().trim().min(1).max(160).optional(),
  expiresAt: external_exports.string().datetime({ offset: true }).optional()
});
var mcpConnectionCredentialRefSchema = external_exports.object({
  name: external_exports.string().trim().min(1).max(120),
  secretId: external_exports.string().uuid(),
  version: external_exports.union([external_exports.literal("latest"), external_exports.number().int().positive()]).optional(),
  placement: toolCredentialPlacementSchema,
  key: external_exports.string().trim().min(1).max(160),
  prefix: external_exports.string().max(120).nullable().optional()
});
var toolTransportConfigSchema = external_exports.record(external_exports.string(), external_exports.unknown()).superRefine(rejectSensitiveConfigKeys);
var toolRedactedValueSummarySchema = external_exports.object({
  summary: external_exports.string().max(4e3),
  sizeBytes: external_exports.number().int().min(0).optional().nullable(),
  sha256: external_exports.string().trim().regex(/^[a-f0-9]{64}$/i).optional().nullable(),
  redactedFields: external_exports.array(external_exports.string().trim().min(1).max(200)).default([]).optional(),
  artifactId: external_exports.string().uuid().optional().nullable()
});
var createToolApplicationSchema = external_exports.object({
  applicationKey: external_exports.string().trim().min(1).max(160).regex(safeKeyPattern).optional(),
  name: external_exports.string().trim().min(1).max(160),
  description: external_exports.string().max(4e3).optional().nullable(),
  type: toolApplicationTypeSchema,
  status: toolApplicationStatusSchema.optional(),
  pluginId: external_exports.string().uuid().optional().nullable(),
  ownerAgentId: external_exports.string().uuid().optional().nullable(),
  ownerUserId: external_exports.string().optional().nullable(),
  metadata: external_exports.record(external_exports.string(), external_exports.unknown()).optional().nullable()
});
var updateToolApplicationSchema = createToolApplicationSchema.partial().refine((value) => Object.keys(value).length > 0, { message: "At least one tool application field is required" });
var createToolConnectionSchema = external_exports.object({
  applicationId: external_exports.string().uuid().optional(),
  applicationName: external_exports.string().trim().min(1).max(160).optional(),
  name: external_exports.string().trim().min(1).max(160),
  transport: toolConnectionTransportSchema.optional(),
  authKind: toolConnectionAuthKindSchema.default("none"),
  ownership: toolConnectionOwnershipSchema.default("customer"),
  status: toolConnectionStatusSchema.optional(),
  connectionKind: toolConnectionKindSchema.default("managed"),
  config: toolTransportConfigSchema.optional(),
  transportConfig: toolTransportConfigSchema.default({}),
  credentialRefs: external_exports.array(mcpConnectionCredentialRefSchema).optional(),
  credentialSecretRefs: external_exports.array(toolCredentialSecretRefSchema).default([]),
  enabled: external_exports.boolean().optional()
});
var updateToolConnectionSchema = createToolConnectionSchema.omit({ applicationId: true }).partial().refine((value) => Object.keys(value).length > 0, { message: "At least one tool connection field is required" });
var connectionGrantSchema = external_exports.object({
  id: external_exports.string().uuid(),
  companyId: external_exports.string().uuid(),
  connectionId: external_exports.string().uuid(),
  kind: connectionGrantKindSchema,
  subjectUserId: external_exports.string().nullable(),
  providerTenant: external_exports.object({
    name: external_exports.string().trim().min(1).max(200).optional(),
    externalId: external_exports.string().trim().min(1).max(400).optional()
  }).nullable(),
  credentialSecretRefs: external_exports.array(toolCredentialSecretRefSchema),
  status: connectionGrantStatusSchema,
  isDefault: external_exports.boolean(),
  createdByAgentId: external_exports.string().uuid().nullable(),
  createdByUserId: external_exports.string().nullable(),
  revokedAt: external_exports.coerce.date().nullable(),
  revokedByAgentId: external_exports.string().uuid().nullable(),
  revokedByUserId: external_exports.string().nullable(),
  lastUsedAt: external_exports.coerce.date().nullable(),
  createdAt: external_exports.coerce.date(),
  updatedAt: external_exports.coerce.date()
}).superRefine((grant, ctx) => {
  if (grant.kind === "user" !== Boolean(grant.subjectUserId)) {
    ctx.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["subjectUserId"], message: "User grants require a subject user; workspace grants must not have one" });
  }
});
var putToolConnectionInstallsSchema = external_exports.object({
  installs: external_exports.array(external_exports.object({
    targetType: toolConnectionInstallTargetTypeSchema,
    targetId: external_exports.string().trim().min(1).max(200)
  })).max(1e3)
}).strict();
var connectionTokenIssuancePathSchema = external_exports.enum(CONNECTION_TOKEN_ISSUANCE_PATHS);
var connectionTokenScopeSchema = external_exports.union([
  external_exports.string().trim().min(1).max(500),
  external_exports.array(external_exports.string().trim().min(1).max(240)).max(100)
]);
var connectionTokenSubjectSchema = external_exports.discriminatedUnion("type", [
  external_exports.object({ type: external_exports.literal("app") }).strict(),
  external_exports.object({ type: external_exports.literal("user"), userId: external_exports.string().trim().min(1).max(500) }).strict()
]);
var connectionTokenRequestSchema = external_exports.object({
  subject: connectionTokenSubjectSchema.optional().default({ type: "app" }),
  scope: connectionTokenScopeSchema.optional(),
  requestedTtlSeconds: external_exports.number().int().positive().max(86400).optional(),
  grantId: external_exports.string().uuid().optional()
}).strict();
var startConnectionAuthorizationSchema = external_exports.object({
  subjectUserId: external_exports.string().trim().min(1).max(500),
  scopes: external_exports.array(external_exports.string().trim().min(1).max(240)).max(100).optional(),
  returnTo: external_exports.string().trim().max(2e3).optional()
}).strict();
var envKeyPattern = /^[A-Z_][A-Z0-9_]*$/i;
var toolStdioTemplateToolSchema = external_exports.object({
  name: external_exports.string().trim().min(1).max(240),
  title: external_exports.string().trim().max(240).optional().nullable(),
  description: external_exports.string().max(8e3).optional().nullable(),
  inputSchema: jsonSchemaSchema.optional().nullable(),
  annotations: external_exports.record(external_exports.string(), external_exports.unknown()).optional().nullable()
});
var createToolStdioCommandTemplateSchema = external_exports.object({
  templateId: external_exports.string().trim().min(1).max(160).regex(safeKeyPattern),
  name: external_exports.string().trim().min(1).max(160),
  description: external_exports.string().max(4e3).optional().nullable(),
  command: external_exports.string().trim().min(1).max(2e3),
  args: external_exports.array(external_exports.string().max(2e3)).max(100).default([]),
  envKeys: external_exports.array(external_exports.string().trim().min(1).max(160).regex(envKeyPattern)).max(200).default([]),
  tools: external_exports.array(toolStdioTemplateToolSchema).max(500).default([])
});
var disableToolStdioCommandTemplateSchema = external_exports.object({
  reason: external_exports.string().trim().max(1e3).optional().nullable()
});
var connectToolAppSchema = external_exports.object({
  galleryKey: external_exports.string().trim().min(1).max(120).optional(),
  link: external_exports.string().trim().url().max(2e3).optional(),
  name: external_exports.string().trim().min(1).max(160).optional(),
  credentialValues: external_exports.record(external_exports.string().trim().min(1).max(200), external_exports.string().min(1)).optional(),
  configValues: external_exports.record(external_exports.string().trim().min(1).max(200), external_exports.unknown()).optional(),
  applicationId: external_exports.string().uuid().optional()
}).refine((value) => Boolean(value.galleryKey) !== Boolean(value.link), { message: "Provide exactly one of galleryKey or link" });
var reconnectToolAppSchema = external_exports.object({
  credentialValues: external_exports.record(external_exports.string().trim().min(1).max(200), external_exports.string().min(1))
});
var finishToolAppSchema = external_exports.object({
  enabledCatalogEntryIds: external_exports.array(external_exports.string().uuid()).max(500).default([]),
  askFirstCatalogEntryIds: external_exports.array(external_exports.string().uuid()).max(500).default([]),
  access: external_exports.union([
    external_exports.literal("all_agents"),
    external_exports.object({ agentIds: external_exports.array(external_exports.string().uuid()).min(1).max(250) })
  ])
});
var upsertToolCatalogEntrySchema = external_exports.object({
  applicationId: external_exports.string().uuid(),
  connectionId: external_exports.string().uuid(),
  entryKind: toolCatalogEntryKindSchema.default("tool"),
  toolName: external_exports.string().trim().min(1).max(240),
  title: external_exports.string().trim().max(240).optional().nullable(),
  description: external_exports.string().max(8e3).optional().nullable(),
  inputSchema: jsonSchemaSchema.optional().nullable(),
  outputSchema: jsonSchemaSchema.optional().nullable(),
  annotations: external_exports.record(external_exports.string(), external_exports.unknown()).optional().nullable(),
  riskLevel: toolRiskLevelSchema.default("medium"),
  isReadOnly: external_exports.boolean().default(false),
  isWrite: external_exports.boolean().default(false),
  isDestructive: external_exports.boolean().default(false),
  status: toolCatalogEntryStatusSchema.default("active"),
  version: external_exports.string().trim().max(200).optional().nullable(),
  schemaHash: external_exports.string().trim().max(128).optional().nullable()
});
var createToolProfileSchema = external_exports.object({
  profileKey: external_exports.string().trim().min(1).max(160).regex(safeKeyPattern),
  name: external_exports.string().trim().min(1).max(160),
  description: external_exports.string().max(4e3).optional().nullable(),
  status: toolProfileStatusSchema.default("active"),
  defaultAction: toolProfileDefaultActionSchema.default("deny"),
  metadata: external_exports.record(external_exports.string(), external_exports.unknown()).optional().nullable()
});
var updateToolProfileSchema = createToolProfileSchema.partial().refine((value) => Object.keys(value).length > 0, { message: "At least one tool profile field is required" });
var createToolProfileEntrySchema = external_exports.object({
  profileId: external_exports.string().uuid(),
  selectorType: toolProfileEntrySelectorTypeSchema,
  effect: toolProfileEntryEffectSchema.default("include"),
  applicationId: external_exports.string().uuid().optional().nullable(),
  connectionId: external_exports.string().uuid().optional().nullable(),
  catalogEntryId: external_exports.string().uuid().optional().nullable(),
  toolName: external_exports.string().trim().min(1).max(240).optional().nullable(),
  riskLevel: toolRiskLevelSchema.optional().nullable(),
  conditions: external_exports.record(external_exports.string(), external_exports.unknown()).optional().nullable()
});
var createToolProfileEntryForProfileSchema = createToolProfileEntrySchema.omit({ profileId: true });
var updateToolProfileEntrySchema = createToolProfileEntryForProfileSchema.partial().refine((value) => Object.keys(value).length > 0, { message: "At least one tool profile entry field is required" });
var createToolProfileWithEntriesSchema = createToolProfileSchema.extend({
  entries: external_exports.array(createToolProfileEntryForProfileSchema).max(250).optional()
});
var duplicateToolProfileSchema = external_exports.object({
  name: external_exports.string().trim().min(1).max(160),
  includeAssignments: external_exports.boolean().default(false)
});
var updateToolProfileWithEntriesSchema = createToolProfileSchema.partial().extend({
  entries: external_exports.array(createToolProfileEntryForProfileSchema).max(250).optional()
}).refine((value) => Object.keys(value).length > 0, { message: "At least one tool profile field is required" });
var reviewToolProfileNewToolsSchema = external_exports.object({
  decisions: external_exports.array(external_exports.object({
    catalogEntryId: external_exports.string().uuid(),
    decision: external_exports.enum(["allow", "keep_blocked"])
  })).min(1).max(250)
});
var deleteToolProfileSchema = external_exports.object({
  force: external_exports.boolean().default(false),
  reassignToProfileId: external_exports.string().uuid().optional()
}).default({});
var createToolProfileBindingSchema = external_exports.object({
  profileId: external_exports.string().uuid(),
  targetType: toolProfileBindingTargetTypeSchema,
  targetId: external_exports.string().trim().min(1).max(200),
  priority: external_exports.number().int().min(0).max(1e4).default(100),
  metadata: external_exports.record(external_exports.string(), external_exports.unknown()).optional().nullable()
});
var createToolProfileBindingForProfileSchema = createToolProfileBindingSchema.omit({ profileId: true });
var unbindToolProfileBindingSchema = createToolProfileBindingForProfileSchema.pick({
  targetType: true,
  targetId: true
});
var headerNameSchema = external_exports.string().trim().min(1).max(120).regex(/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/);
var toolMcpGatewayAuthConfigSchema = external_exports.object({
  version: external_exports.literal(1).default(1),
  bearer: external_exports.object({
    enabled: external_exports.boolean().default(true),
    tokenPrefix: external_exports.literal("pcgw").default("pcgw"),
    defaultTtlSeconds: external_exports.number().int().positive().max(31536e3).nullable().default(7776e3),
    requireFiniteExpiry: external_exports.boolean().default(true),
    longLivedTokenRequiresOverride: external_exports.boolean().default(true)
  }).default({}),
  oauth: external_exports.object({
    enabled: external_exports.literal(false).default(false),
    reservedFor: external_exports.literal("v1_5").default("v1_5"),
    protectedResourceMetadataPath: external_exports.string().trim().max(240).optional().nullable(),
    dynamicClientRegistration: external_exports.literal(false).optional(),
    authorizationCodePkce: external_exports.literal(false).optional()
  }).default({})
});
var toolMcpGatewayHeaderPolicySchema = external_exports.object({
  version: external_exports.literal(1).default(1),
  callerPassthrough: external_exports.object({
    enabled: external_exports.boolean().default(false),
    allowedHeaders: external_exports.array(headerNameSchema).max(50).default([])
  }).default({}),
  staticHeaders: external_exports.array(external_exports.object({
    name: headerNameSchema,
    valueRef: external_exports.string().trim().max(240).optional().nullable(),
    value: external_exports.string().max(4e3).optional().nullable()
  })).max(50).default([]),
  generatedMetadata: external_exports.object({
    enabled: external_exports.boolean().default(false),
    allowedHeaders: external_exports.array(headerNameSchema).max(20).default([])
  }).default({}),
  responseHeaders: external_exports.object({
    forwardMcpRequiredHeaders: external_exports.boolean().default(true),
    forwardSafeCacheHeaders: external_exports.boolean().default(true)
  }).default({})
});
var toolMcpGatewayMetadataPolicySchema = external_exports.object({
  version: external_exports.literal(1).default(1),
  forwardCompanyId: external_exports.boolean().default(false),
  forwardGatewayId: external_exports.boolean().default(false),
  forwardProjectId: external_exports.boolean().default(false),
  forwardIssueId: external_exports.boolean().default(false),
  forwardAgentId: external_exports.boolean().default(false),
  forwardRunId: external_exports.boolean().default(false),
  forwardCorrelationId: external_exports.boolean().default(true)
});
var toolMcpGatewayOnDemandToolsConfigSchema = external_exports.object({
  enabled: external_exports.boolean().default(false),
  searchToolName: external_exports.literal("search_tools").default("search_tools"),
  runToolName: external_exports.literal("run_tool").default("run_tool")
});
var createToolMcpGatewaySchema = external_exports.object({
  name: external_exports.string().trim().min(1).max(160),
  slug: external_exports.string().trim().min(1).max(120).regex(safeKeyPattern).optional(),
  displaySlug: external_exports.string().trim().min(1).max(120).regex(safeKeyPattern).optional(),
  description: external_exports.string().max(4e3).optional().nullable(),
  profileId: external_exports.string().uuid(),
  defaultProfileMode: toolMcpGatewayDefaultProfileModeSchema.default("gateway_only").optional(),
  contextScopeType: toolMcpGatewayContextScopeTypeSchema.default("none").optional(),
  contextScopeId: external_exports.string().trim().min(1).max(200).optional().nullable(),
  agentId: external_exports.string().uuid().optional().nullable(),
  projectId: external_exports.string().uuid().optional().nullable(),
  issueId: external_exports.string().uuid().optional().nullable(),
  approvalIssueId: external_exports.string().uuid().optional().nullable(),
  authConfig: toolMcpGatewayAuthConfigSchema.optional(),
  headerPolicy: toolMcpGatewayHeaderPolicySchema.optional(),
  metadataPolicy: toolMcpGatewayMetadataPolicySchema.optional(),
  onDemandToolsConfig: toolMcpGatewayOnDemandToolsConfigSchema.optional(),
  metadata: external_exports.record(external_exports.string(), external_exports.unknown()).optional().nullable()
});
var updateToolMcpGatewaySchema = createToolMcpGatewaySchema.partial().extend({ status: toolMcpGatewayStatusSchema.optional() }).refine((value) => Object.keys(value).length > 0, { message: "At least one gateway field is required" });
var createToolMcpGatewayTokenSchema = external_exports.object({
  name: external_exports.string().trim().min(1).max(160),
  subjectType: toolMcpGatewayTokenSubjectTypeSchema.default("gateway_client").optional(),
  subjectId: external_exports.string().trim().min(1).max(240).optional().nullable(),
  clientLabel: external_exports.string().trim().min(1).max(160),
  ownerNote: external_exports.string().trim().min(1).max(1e3),
  allowedActions: external_exports.array(toolMcpGatewayTokenActionSchema).min(1).max(TOOL_MCP_GATEWAY_TOKEN_ACTIONS.length).default(["tools/list", "tools/call"]).optional(),
  expiresAt: external_exports.coerce.date().optional().nullable(),
  expiryOverrideReason: external_exports.string().trim().min(1).max(1e3).optional().nullable()
}).superRefine((value, ctx) => {
  if (value.subjectType && value.subjectType !== "gateway_client") {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["subjectType"],
      message: "Public V1 token minting only supports gateway_client subjects; heartbeat_run is runtime-managed, while board_user and agent are reserved for later OAuth/user-bound flows."
    });
  }
  if (value.expiresAt === null && !value.expiryOverrideReason) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["expiryOverrideReason"],
      message: "Non-expiring gateway tokens require an override reason."
    });
  }
});
var argumentConditionSchema = external_exports.object({
  fieldEquals: external_exports.record(external_exports.string().trim().min(1).max(120), external_exports.unknown()).optional(),
  fieldNotEquals: external_exports.record(external_exports.string().trim().min(1).max(120), external_exports.unknown()).optional(),
  fieldIn: external_exports.record(external_exports.string().trim().min(1).max(120), external_exports.array(external_exports.unknown()).min(1).max(100)).optional(),
  fieldMatches: external_exports.record(external_exports.string().trim().min(1).max(120), external_exports.string().trim().min(1).max(500)).optional(),
  fieldExists: external_exports.array(external_exports.string().trim().min(1).max(120)).max(100).optional(),
  fieldAbsent: external_exports.array(external_exports.string().trim().min(1).max(120)).max(100).optional()
}).strict().refine((value) => Object.values(value).some((nested) => Array.isArray(nested) ? nested.length > 0 : Boolean(nested && Object.keys(nested).length > 0)), { message: "Argument conditions must include at least one field predicate" });
var timeWindowConditionSchema = external_exports.object({
  startAt: external_exports.string().trim().datetime({ offset: true }).optional(),
  endAt: external_exports.string().trim().datetime({ offset: true }).optional(),
  daysOfWeekUtc: external_exports.array(external_exports.number().int().min(0).max(6)).max(7).optional(),
  startHourUtc: external_exports.number().int().min(0).max(23).optional(),
  endHourUtc: external_exports.number().int().min(0).max(24).optional()
}).strict().refine((value) => value.startAt || value.endAt || value.daysOfWeekUtc?.length || value.startHourUtc !== void 0 || value.endHourUtc !== void 0, { message: "timeWindow must include at least one bound" });
var actorConditionSchema = external_exports.object({
  actorType: external_exports.enum(["agent", "user", "system", "plugin"]).optional(),
  actorTypes: external_exports.array(external_exports.enum(["agent", "user", "system", "plugin"])).max(20).optional(),
  agentId: external_exports.string().uuid().optional(),
  agentIds: external_exports.array(external_exports.string().uuid()).max(100).optional()
}).strict();
var contextConditionSchema = external_exports.object({
  projectId: external_exports.string().uuid().optional(),
  projectIds: external_exports.array(external_exports.string().uuid()).max(100).optional(),
  routineId: external_exports.string().uuid().optional(),
  routineIds: external_exports.array(external_exports.string().uuid()).max(100).optional(),
  issueId: external_exports.string().uuid().optional(),
  issueIds: external_exports.array(external_exports.string().uuid()).max(100).optional(),
  requireIssue: external_exports.boolean().optional(),
  requireProject: external_exports.boolean().optional(),
  requireRoutine: external_exports.boolean().optional()
}).strict();
var credentialScopeConditionSchema = external_exports.object({
  applicationId: external_exports.string().uuid().optional(),
  applicationIds: external_exports.array(external_exports.string().uuid()).max(100).optional(),
  connectionId: external_exports.string().uuid().optional(),
  connectionIds: external_exports.array(external_exports.string().uuid()).max(100).optional(),
  catalogEntryId: external_exports.string().uuid().optional(),
  catalogEntryIds: external_exports.array(external_exports.string().uuid()).max(100).optional(),
  applicationKey: external_exports.string().trim().min(1).max(160).optional(),
  applicationKeys: external_exports.array(external_exports.string().trim().min(1).max(160)).max(100).optional(),
  providerType: external_exports.string().trim().min(1).max(160).optional(),
  providerTypes: external_exports.array(external_exports.string().trim().min(1).max(160)).max(100).optional()
}).strict();
var toolPolicyConditionsSchema = external_exports.object({
  arguments: argumentConditionSchema.optional(),
  args: argumentConditionSchema.optional(),
  actor: actorConditionSchema.optional(),
  context: contextConditionSchema.optional(),
  risk: external_exports.object({
    levels: external_exports.array(toolRiskLevelSchema).max(20).optional(),
    max: toolRiskLevelSchema.optional(),
    isWrite: external_exports.boolean().optional(),
    isDestructive: external_exports.boolean().optional()
  }).strict().optional(),
  credentialScope: credentialScopeConditionSchema.optional(),
  trustBoundary: external_exports.object({
    providerType: external_exports.string().trim().min(1).max(160).optional(),
    providerTypes: external_exports.array(external_exports.string().trim().min(1).max(160)).max(100).optional(),
    applicationKey: external_exports.string().trim().min(1).max(160).optional(),
    applicationKeys: external_exports.array(external_exports.string().trim().min(1).max(160)).max(100).optional(),
    remoteHttpOnly: external_exports.boolean().optional(),
    paperclipSelfOnly: external_exports.boolean().optional()
  }).strict().optional(),
  timeWindow: timeWindowConditionSchema.optional()
}).strict().refine((value) => Object.keys(value).length > 0, { message: "Tool policy conditions must include at least one supported condition group" });
var createToolPolicySchema = external_exports.object({
  name: external_exports.string().trim().min(1).max(160),
  description: external_exports.string().max(4e3).optional().nullable(),
  policyType: toolPolicyTypeSchema,
  priority: external_exports.number().int().min(0).max(1e4).default(100),
  enabled: external_exports.boolean().default(true),
  selectors: external_exports.record(external_exports.string(), external_exports.unknown()).default({}),
  conditions: toolPolicyConditionsSchema.optional().nullable(),
  config: external_exports.record(external_exports.string(), external_exports.unknown()).optional().nullable()
});
var updateToolPolicySchema = createToolPolicySchema.partial().refine((value) => Object.keys(value).length > 0, { message: "At least one tool policy field is required" });
var reorderToolPoliciesSchema = external_exports.object({
  policyIds: external_exports.array(external_exports.string().uuid()).min(1).max(500)
});
var duplicateToolPolicySchema = external_exports.object({
  name: external_exports.string().trim().min(1).max(160).optional()
});
var createToolInvocationSchema = external_exports.object({
  idempotencyKey: external_exports.string().trim().min(1).max(300).optional().nullable(),
  issueId: external_exports.string().uuid().optional().nullable(),
  runId: external_exports.string().uuid().optional().nullable(),
  applicationId: external_exports.string().uuid().optional().nullable(),
  connectionId: external_exports.string().uuid().optional().nullable(),
  catalogEntryId: external_exports.string().uuid().optional().nullable(),
  toolName: external_exports.string().trim().min(1).max(240),
  argumentsHash: external_exports.string().trim().max(128).optional().nullable(),
  argumentsSummary: toolRedactedValueSummarySchema.optional().nullable()
});
var createToolActionRequestSchema = external_exports.object({
  invocationId: external_exports.string().uuid(),
  issueId: external_exports.string().uuid().optional().nullable(),
  canonicalArgumentsHash: external_exports.string().trim().min(1).max(128),
  canonicalArgumentsSummary: toolRedactedValueSummarySchema,
  signedArguments: external_exports.string().trim().max(4096).optional().nullable(),
  previewMarkdown: external_exports.string().max(2e4).optional().nullable(),
  expiresAt: external_exports.coerce.date().optional().nullable()
});
var toolConnectionTestCallSchema = external_exports.object({
  agentId: external_exports.string().uuid(),
  toolName: external_exports.string().trim().min(1).max(240),
  parameters: external_exports.unknown().optional()
});
var importMcpJsonSchema = external_exports.object({
  mcpJson: external_exports.union([external_exports.string(), external_exports.record(external_exports.string(), external_exports.unknown())])
});
var toolAccessSelectorSchema = external_exports.object({
  actorType: external_exports.enum(["agent", "user", "system", "plugin"]).optional(),
  agentId: external_exports.string().uuid().optional(),
  agentIds: external_exports.array(external_exports.string().uuid()).optional(),
  projectId: external_exports.string().uuid().optional(),
  projectIds: external_exports.array(external_exports.string().uuid()).optional(),
  routineId: external_exports.string().uuid().optional(),
  routineIds: external_exports.array(external_exports.string().uuid()).optional(),
  issueId: external_exports.string().uuid().optional(),
  issueIds: external_exports.array(external_exports.string().uuid()).optional(),
  gatewayId: external_exports.string().uuid().optional(),
  gatewayIds: external_exports.array(external_exports.string().uuid()).optional(),
  gatewayPublicId: external_exports.string().trim().min(1).max(120).regex(safeKeyPattern).optional(),
  gatewayPublicIds: external_exports.array(external_exports.string().trim().min(1).max(120).regex(safeKeyPattern)).optional(),
  gatewayTokenId: external_exports.string().uuid().optional(),
  gatewayTokenIds: external_exports.array(external_exports.string().uuid()).optional(),
  clientSubjectType: toolMcpGatewayTokenSubjectTypeSchema.optional(),
  clientSubjectTypes: external_exports.array(toolMcpGatewayTokenSubjectTypeSchema).optional(),
  clientName: external_exports.string().trim().min(1).max(160).optional(),
  clientNames: external_exports.array(external_exports.string().trim().min(1).max(160)).optional(),
  externalClient: external_exports.boolean().optional(),
  applicationId: external_exports.string().uuid().optional(),
  applicationIds: external_exports.array(external_exports.string().uuid()).optional(),
  connectionId: external_exports.string().uuid().optional(),
  connectionIds: external_exports.array(external_exports.string().uuid()).optional(),
  catalogEntryId: external_exports.string().uuid().optional(),
  catalogEntryIds: external_exports.array(external_exports.string().uuid()).optional(),
  toolName: external_exports.string().trim().min(1).max(240).optional(),
  toolNames: external_exports.array(external_exports.string().trim().min(1).max(240)).optional(),
  riskLevel: toolRiskLevelSchema.optional(),
  riskLevels: external_exports.array(toolRiskLevelSchema).optional()
});
var toolRateLimitRuleSchema = external_exports.object({
  limit: external_exports.number().int().positive().max(1e6),
  windowSeconds: external_exports.number().int().positive().max(31536e3),
  keyBy: external_exports.array(external_exports.enum(["company", "agent", "application", "connection", "tool"])).optional()
});
var toolTrustRuleArgumentFiltersSchema = external_exports.object({
  allowAny: external_exports.boolean().optional(),
  exactHash: external_exports.string().trim().regex(/^[a-f0-9]{64}$/i).optional().nullable(),
  allowedHashes: external_exports.array(external_exports.string().trim().regex(/^[a-f0-9]{64}$/i)).max(100).optional(),
  fieldEquals: external_exports.record(external_exports.string().trim().min(1).max(120), external_exports.unknown()).optional(),
  fieldNotEquals: external_exports.record(external_exports.string().trim().min(1).max(120), external_exports.unknown()).optional(),
  fieldIn: external_exports.record(external_exports.string().trim().min(1).max(120), external_exports.array(external_exports.unknown()).min(1).max(100)).optional(),
  fieldMatches: external_exports.record(external_exports.string().trim().min(1).max(120), external_exports.string().trim().min(1).max(500)).optional(),
  fieldExists: external_exports.array(external_exports.string().trim().min(1).max(120)).max(100).optional(),
  fieldAbsent: external_exports.array(external_exports.string().trim().min(1).max(120)).max(100).optional()
}).refine((value) => value.allowAny === true || Boolean(value.exactHash) || Boolean(value.allowedHashes?.length) || Boolean(value.fieldEquals && Object.keys(value.fieldEquals).length > 0) || Boolean(value.fieldNotEquals && Object.keys(value.fieldNotEquals).length > 0) || Boolean(value.fieldIn && Object.keys(value.fieldIn).length > 0) || Boolean(value.fieldMatches && Object.keys(value.fieldMatches).length > 0) || Boolean(value.fieldExists?.length) || Boolean(value.fieldAbsent?.length), { message: "Trust-rule argument filters must specify allowAny, a hash filter, or a field predicate" });
var toolTrustRuleScopeSchema = external_exports.object({
  includeAgent: external_exports.boolean().optional(),
  includeProject: external_exports.boolean().optional(),
  includeIssue: external_exports.boolean().optional(),
  includeApplication: external_exports.boolean().optional(),
  includeConnection: external_exports.boolean().optional(),
  includeCatalogEntry: external_exports.boolean().optional(),
  includeTool: external_exports.boolean().optional()
});
var toolTrustRuleBatchApprovalSchema = external_exports.object({
  enabled: external_exports.boolean().optional(),
  maxBatchSize: external_exports.number().int().positive().max(100).optional(),
  windowSeconds: external_exports.number().int().positive().max(31536e3).optional()
});
var createToolTrustRuleFromActionRequestSchema = external_exports.object({
  name: external_exports.string().trim().min(1).max(160).optional(),
  description: external_exports.string().max(4e3).optional().nullable(),
  priority: external_exports.number().int().min(0).max(1e4).default(40),
  approvalThreshold: external_exports.number().int().min(1).max(50).default(2),
  selectors: toolAccessSelectorSchema.optional(),
  scope: toolTrustRuleScopeSchema.optional(),
  argumentFilters: toolTrustRuleArgumentFiltersSchema.optional(),
  expiresAt: external_exports.coerce.date().optional().nullable(),
  batchApproval: toolTrustRuleBatchApprovalSchema.optional().nullable()
});
var revokeToolTrustRuleSchema = external_exports.object({
  reason: external_exports.string().trim().max(1e3).optional().nullable()
});
var toolPolicyTestRequestSchema = external_exports.object({
  companyId: external_exports.string().uuid(),
  actor: external_exports.object({
    actorType: external_exports.enum(["agent", "user", "system", "plugin"]),
    actorId: external_exports.string().trim().min(1).max(240),
    agentId: external_exports.string().uuid().optional().nullable()
  }),
  runContext: external_exports.object({
    heartbeatRunId: external_exports.string().uuid().optional().nullable(),
    issueId: external_exports.string().uuid().optional().nullable(),
    projectId: external_exports.string().uuid().optional().nullable(),
    routineId: external_exports.string().uuid().optional().nullable(),
    gatewayId: external_exports.string().uuid().optional().nullable(),
    gatewayPublicId: external_exports.string().trim().min(1).max(120).regex(safeKeyPattern).optional().nullable(),
    gatewayTokenId: external_exports.string().uuid().optional().nullable(),
    clientSubjectType: toolMcpGatewayTokenSubjectTypeSchema.optional().nullable(),
    clientSubjectId: external_exports.string().trim().min(1).max(240).optional().nullable(),
    clientName: external_exports.string().trim().min(1).max(160).optional().nullable(),
    externalClient: external_exports.boolean().optional().nullable()
  }).optional().nullable(),
  request: external_exports.object({
    applicationId: external_exports.string().uuid().optional().nullable(),
    connectionId: external_exports.string().uuid().optional().nullable(),
    catalogEntryId: external_exports.string().uuid().optional().nullable(),
    toolName: external_exports.string().trim().min(1).max(240),
    arguments: external_exports.unknown().optional(),
    idempotencyKey: external_exports.string().trim().min(1).max(512).optional().nullable(),
    sideEffecting: external_exports.boolean().optional()
  }),
  consumeRateLimit: external_exports.boolean().optional(),
  writeAuditEvent: external_exports.boolean().optional()
});

// ../../node_modules/.pnpm/@paperclipai+shared@2026.722.0/node_modules/@paperclipai/shared/dist/validators/app-definition.js
var field = external_exports.object({ key: external_exports.string().min(1), label: external_exports.string().min(1), type: external_exports.enum(["text", "password", "textarea", "datetime", "select", "checkbox"]), required: external_exports.boolean().optional(), placeholder: external_exports.string().optional(), helperMd: external_exports.string().optional(), secret: external_exports.boolean().optional(), prefix: external_exports.string().optional() }).superRefine((v, c) => {
  if (v.required && v.type !== "checkbox" && !v.placeholder)
    c.addIssue({ code: "custom", message: "Required fields need placeholders", path: ["placeholder"] });
});
var connectionMethodDefSchema = external_exports.object({ key: external_exports.string().min(1), transport: toolConnectionTransportSchema, auth: external_exports.enum(["oauth", "api_key", "none"]), ownershipModes: external_exports.array(toolConnectionOwnershipSchema).min(1), whenToUse: external_exports.string().min(1), defaults: external_exports.object({ serverUrl: external_exports.string().url().optional(), discoveryUrl: external_exports.string().url().nullable().optional(), serviceHost: external_exports.string().optional(), templateKey: external_exports.string().optional(), authorizationEndpoint: external_exports.string().url().optional(), tokenEndpoint: external_exports.string().url().optional(), metadataUrl: external_exports.string().url().optional(), scopesHint: external_exports.array(external_exports.string()).optional() }).optional(), tenantFields: external_exports.array(field).optional(), extensionFields: external_exports.array(field).optional(), credentialFields: external_exports.array(field).optional(), keyPlacement: external_exports.object({ location: external_exports.enum(["header", "query", "body_json", "env"]), name: external_exports.string().min(1), prefix: external_exports.string().nullable().optional() }).optional(), guidanceMd: external_exports.string().min(1), consoleLinks: external_exports.object({ register: external_exports.string().url().optional(), keys: external_exports.string().url().optional(), settings: external_exports.string().url().optional(), docs: external_exports.string().url().optional() }).optional(), warnings: external_exports.array(external_exports.string()).optional(), variants: external_exports.array(external_exports.object({ key: external_exports.string(), label: external_exports.string(), whenToUse: external_exports.string(), tenantFields: external_exports.array(field).optional() })).optional(), riskTier: external_exports.enum(["S1", "S2", "S3", "S4"]), requiredResourceFilters: external_exports.array(external_exports.string()).optional() }).superRefine((v, c) => {
  if (v.auth === "api_key" && !v.keyPlacement)
    c.addIssue({ code: "custom", message: "API-key methods require keyPlacement", path: ["keyPlacement"] });
});
var appDefinitionSchema = external_exports.object({ schemaVersion: external_exports.literal(1), slug: external_exports.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), name: external_exports.string().min(1), description: external_exports.string().min(1), categories: external_exports.array(external_exports.enum(["ai", "analytics", "commerce", "communication", "content", "data", "developer", "productivity", "other"])).min(1), featured: external_exports.boolean().optional(), branding: external_exports.object({ logoUrl: external_exports.string().url(), darkLogoUrl: external_exports.string().url().optional(), backgroundColor: external_exports.string().optional(), accentColor: external_exports.string().optional() }), urlPatterns: external_exports.array(external_exports.string()), docsUrl: external_exports.string().url().optional(), methods: external_exports.array(connectionMethodDefSchema).min(1), suggestable: external_exports.boolean().optional(), availability: external_exports.object({ available: external_exports.boolean(), reason: external_exports.string().optional(), robotEmail: external_exports.string().optional() }).optional(), ownershipAvailability: external_exports.object({ platform_shared: external_exports.boolean().optional(), platform_provisioned: external_exports.boolean().optional(), customer: external_exports.boolean().optional(), dcr: external_exports.boolean().optional() }).optional() });
var appDefinitionsSchema = external_exports.array(appDefinitionSchema).superRefine((v, c) => {
  const s = /* @__PURE__ */ new Set();
  v.forEach((a, i) => {
    if (s.has(a.slug))
      c.addIssue({ code: "custom", message: "Duplicate slug", path: [i, "slug"] });
    s.add(a.slug);
  });
});

// ../../node_modules/.pnpm/@paperclipai+shared@2026.722.0/node_modules/@paperclipai/shared/dist/validators/summary-slot.js
var optionalScopeIdSchema = external_exports.string().uuid().optional().nullable();
var summarySlotScopeKindSchema = external_exports.enum(SUMMARY_SLOT_SCOPE_KINDS);
var summarySlotKeySchema = external_exports.enum(SUMMARY_SLOT_KEYS);
var summarySlotStatusSchema = external_exports.enum(SUMMARY_SLOT_STATUSES);
var summarySlotScopeSelectorSchema = external_exports.object({
  scopeKind: summarySlotScopeKindSchema,
  scopeId: optionalScopeIdSchema,
  slotKey: summarySlotKeySchema
}).strict().superRefine((value, ctx) => {
  const hasScopeId = typeof value.scopeId === "string";
  if (value.scopeKind === "workspaces_overview") {
    if (hasScopeId) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        message: "workspaces_overview summary slots must not include scopeId",
        path: ["scopeId"]
      });
    }
    return;
  }
  if (!hasScopeId) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      message: `${value.scopeKind} summary slots require scopeId`,
      path: ["scopeId"]
    });
  }
});
var summarySlotQuerySchema = external_exports.object({
  scopeId: optionalScopeIdSchema
}).strict();
var writeSummarySlotSchema = external_exports.object({
  scopeId: optionalScopeIdSchema,
  markdown: external_exports.string().trim().min(1).max(2e5),
  title: external_exports.string().trim().min(1).max(200).optional().nullable(),
  changeSummary: external_exports.string().trim().min(1).max(1e3).optional().nullable(),
  baseRevisionId: external_exports.string().uuid().optional().nullable(),
  generationIssueId: external_exports.string().uuid().optional().nullable(),
  model: external_exports.string().trim().min(1).max(200).optional().nullable()
}).strict();

// ../../node_modules/.pnpm/@paperclipai+shared@2026.722.0/node_modules/@paperclipai/shared/dist/network-bind.js
function normalizeHost(host) {
  const trimmed = host?.trim();
  return trimmed ? trimmed : void 0;
}
function isLoopbackHost(host) {
  const normalized = normalizeHost(host)?.toLowerCase();
  return normalized === "127.0.0.1" || normalized === "localhost" || normalized === "::1";
}
function isAllInterfacesHost(host) {
  const normalized = normalizeHost(host)?.toLowerCase();
  return normalized === "0.0.0.0" || normalized === "::";
}
function inferBindModeFromHost(host, opts) {
  const normalized = normalizeHost(host);
  const tailnetBindHost = normalizeHost(opts?.tailnetBindHost);
  if (!normalized || isLoopbackHost(normalized))
    return "loopback";
  if (isAllInterfacesHost(normalized))
    return "lan";
  if (tailnetBindHost && normalized === tailnetBindHost)
    return "tailnet";
  return "custom";
}
function validateConfiguredBindMode(input) {
  const bind = input.bind ?? inferBindModeFromHost(input.host);
  const customBindHost = normalizeHost(input.customBindHost);
  const errors = [];
  if (input.deploymentMode === "local_trusted" && bind !== "loopback") {
    errors.push("local_trusted requires server.bind=loopback");
  }
  if (bind === "custom" && !customBindHost) {
    const legacyHost = normalizeHost(input.host);
    if (!legacyHost || isLoopbackHost(legacyHost) || isAllInterfacesHost(legacyHost)) {
      errors.push("server.customBindHost is required when server.bind=custom");
    }
  }
  if (input.deploymentMode === "authenticated" && input.deploymentExposure === "public" && bind === "tailnet") {
    errors.push("server.bind=tailnet is only supported for authenticated/private deployments");
  }
  return errors;
}

// ../../node_modules/.pnpm/@paperclipai+shared@2026.722.0/node_modules/@paperclipai/shared/dist/types/smoke-lab.js
var SMOKE_RUN_TRIGGERS = ["manual", "routine", "ci"];
var SMOKE_RUN_STATUSES = ["running", "passed", "failed", "cancelled"];
var SMOKE_RUN_STEP_PATHS = ["P1", "P2", "P3", "P4", "P5", "P6", "P7"];
var SMOKE_RUN_STEP_STATUSES = ["pass", "fail", "skipped"];

// ../../node_modules/.pnpm/@paperclipai+shared@2026.722.0/node_modules/@paperclipai/shared/dist/types/instance.js
var DAILY_RETENTION_PRESETS = [3, 7, 14];
var WEEKLY_RETENTION_PRESETS = [1, 2, 4];
var MONTHLY_RETENTION_PRESETS = [1, 3, 6];
var DEFAULT_ISSUE_GRAPH_LIVENESS_AUTO_RECOVERY_LOOKBACK_HOURS = 24;
var MIN_ISSUE_GRAPH_LIVENESS_AUTO_RECOVERY_LOOKBACK_HOURS = 1;
var MAX_ISSUE_GRAPH_LIVENESS_AUTO_RECOVERY_LOOKBACK_HOURS = 24 * 30;
var DEFAULT_BACKUP_RETENTION = {
  dailyDays: 7,
  weeklyWeeks: 4,
  monthlyMonths: 1
};

// ../../node_modules/.pnpm/@paperclipai+shared@2026.722.0/node_modules/@paperclipai/shared/dist/types/search.js
var COMPANY_SEARCH_SCOPES = ["all", "issues", "comments", "documents", "artifacts", "agents", "projects"];
var COMPANY_SEARCH_SORTS = ["relevance", "updated", "created", "priority"];
var COMPANY_SEARCH_EXTRACT_SCOPES = ["all", "issues", "comments", "documents"];
var COMPANY_SEARCH_EXTRACT_KINDS = ["literal", "url"];

// ../../node_modules/.pnpm/@paperclipai+shared@2026.722.0/node_modules/@paperclipai/shared/dist/types/resource-memberships.js
var RESOURCE_MEMBERSHIP_STATES = ["joined", "left"];

// ../../node_modules/.pnpm/@paperclipai+shared@2026.722.0/node_modules/@paperclipai/shared/dist/validators/sidebar-preferences.js
var sidebarOrderedIdSchema = external_exports.string().uuid();
var sidebarOrderPreferenceSchema = external_exports.object({
  orderedIds: external_exports.array(sidebarOrderedIdSchema),
  updatedAt: external_exports.coerce.date().nullable()
});
var upsertSidebarOrderPreferenceSchema = external_exports.object({
  orderedIds: external_exports.array(sidebarOrderedIdSchema)
});

// ../../node_modules/.pnpm/@paperclipai+shared@2026.722.0/node_modules/@paperclipai/shared/dist/validators/resource-memberships.js
var resourceMembershipStateSchema = external_exports.enum(RESOURCE_MEMBERSHIP_STATES);
var updateResourceMembershipSchema = external_exports.object({
  state: resourceMembershipStateSchema.optional(),
  starred: external_exports.boolean().optional()
}).refine((value) => value.state !== void 0 || value.starred !== void 0, {
  message: "state or starred is required"
}).refine((value) => !(value.state === "left" && value.starred === true), {
  message: "starred resources must be joined",
  path: ["starred"]
});

// ../../node_modules/.pnpm/@paperclipai+shared@2026.722.0/node_modules/@paperclipai/shared/dist/validators/inbox-agent-policy.js
var inboxAgentPolicyModeSchema = external_exports.enum(["open", "allowlist", "disabled"]);
var updateInboxAgentPolicySchema = external_exports.object({
  mode: inboxAgentPolicyModeSchema,
  allowedAgentIds: external_exports.array(external_exports.string().uuid()).max(100).default([])
}).strict().superRefine((value, ctx) => {
  if (value.mode !== "allowlist" && value.allowedAgentIds.length > 0) {
    ctx.addIssue({
      code: "custom",
      message: 'allowedAgentIds must be empty when mode is not "allowlist"',
      path: ["allowedAgentIds"]
    });
  }
});

// ../../node_modules/.pnpm/@paperclipai+shared@2026.722.0/node_modules/@paperclipai/shared/dist/validators/execution-workspace.js
var executionWorkspaceStatusSchema = external_exports.enum([
  "active",
  "idle",
  "in_review",
  "archived",
  "cleanup_failed"
]);
var workspaceOverviewStatusFilterSchema = external_exports.preprocess((value) => {
  if (value === void 0 || value === null)
    return void 0;
  const rawValues = Array.isArray(value) ? value : [value];
  const statuses = rawValues.flatMap((entry) => {
    if (typeof entry !== "string")
      return [];
    return entry.split(",").map((part) => part.trim()).filter(Boolean);
  });
  return statuses.length > 0 ? statuses : void 0;
}, external_exports.array(executionWorkspaceStatusSchema).optional());
var workspaceOverviewQuerySchema = external_exports.object({
  projectId: external_exports.string().uuid().optional(),
  status: workspaceOverviewStatusFilterSchema,
  limit: external_exports.coerce.number().int().min(1).max(WORKSPACE_OVERVIEW_MAX_LIMIT).optional().default(WORKSPACE_OVERVIEW_DEFAULT_LIMIT),
  offset: external_exports.coerce.number().int().min(0).optional().default(0)
}).strict();
var executionWorkspaceConfigSchema = external_exports.object({
  environmentId: external_exports.string().uuid().optional().nullable(),
  provisionCommand: external_exports.string().optional().nullable(),
  teardownCommand: external_exports.string().optional().nullable(),
  cleanupCommand: external_exports.string().optional().nullable(),
  workspaceRuntime: external_exports.record(external_exports.string(), external_exports.unknown()).optional().nullable(),
  desiredState: external_exports.enum(["running", "stopped", "manual"]).optional().nullable(),
  serviceStates: external_exports.record(external_exports.enum(["running", "stopped", "manual"])).optional().nullable()
}).strict();
var workspaceRuntimeControlTargetSchema = external_exports.object({
  workspaceCommandId: external_exports.string().min(1).optional().nullable(),
  runtimeServiceId: external_exports.string().uuid().optional().nullable(),
  serviceIndex: external_exports.number().int().nonnegative().optional().nullable()
}).strict();
var executionWorkspaceCloseReadinessStateSchema = external_exports.enum([
  "ready",
  "ready_with_warnings",
  "blocked"
]);
var executionWorkspaceCloseActionKindSchema = external_exports.enum([
  "archive_record",
  "stop_runtime_services",
  "cleanup_command",
  "teardown_command",
  "git_worktree_remove",
  "git_branch_delete",
  "remove_local_directory"
]);
var executionWorkspaceCloseActionSchema = external_exports.object({
  kind: executionWorkspaceCloseActionKindSchema,
  label: external_exports.string(),
  description: external_exports.string(),
  command: external_exports.string().nullable()
}).strict();
var executionWorkspaceCloseLinkedIssueSchema = external_exports.object({
  id: external_exports.string().uuid(),
  identifier: external_exports.string().nullable(),
  title: external_exports.string(),
  status: external_exports.string(),
  isTerminal: external_exports.boolean()
}).strict();
var executionWorkspaceCloseGitReadinessSchema = external_exports.object({
  repoRoot: external_exports.string().nullable(),
  workspacePath: external_exports.string().nullable(),
  branchName: external_exports.string().nullable(),
  baseRef: external_exports.string().nullable(),
  hasDirtyTrackedFiles: external_exports.boolean(),
  hasUntrackedFiles: external_exports.boolean(),
  dirtyEntryCount: external_exports.number().int().nonnegative(),
  untrackedEntryCount: external_exports.number().int().nonnegative(),
  aheadCount: external_exports.number().int().nonnegative().nullable(),
  behindCount: external_exports.number().int().nonnegative().nullable(),
  isMergedIntoBase: external_exports.boolean().nullable(),
  createdByRuntime: external_exports.boolean()
}).strict();
var workspaceRuntimeServiceSchema = external_exports.object({
  id: external_exports.string(),
  companyId: external_exports.string().uuid(),
  projectId: external_exports.string().uuid().nullable(),
  projectWorkspaceId: external_exports.string().uuid().nullable(),
  executionWorkspaceId: external_exports.string().uuid().nullable(),
  issueId: external_exports.string().uuid().nullable(),
  scopeType: external_exports.enum(["project_workspace", "execution_workspace", "run", "agent"]),
  scopeId: external_exports.string().nullable(),
  serviceName: external_exports.string(),
  status: external_exports.enum(["starting", "running", "stopped", "failed"]),
  lifecycle: external_exports.enum(["shared", "ephemeral"]),
  reuseKey: external_exports.string().nullable(),
  command: external_exports.string().nullable(),
  cwd: external_exports.string().nullable(),
  port: external_exports.number().int().nullable(),
  url: external_exports.string().nullable(),
  provider: external_exports.enum(["local_process", "adapter_managed"]),
  providerRef: external_exports.string().nullable(),
  ownerAgentId: external_exports.string().uuid().nullable(),
  startedByRunId: external_exports.string().uuid().nullable(),
  lastUsedAt: external_exports.coerce.date(),
  startedAt: external_exports.coerce.date(),
  stoppedAt: external_exports.coerce.date().nullable(),
  stopPolicy: external_exports.record(external_exports.string(), external_exports.unknown()).nullable(),
  healthStatus: external_exports.enum(["unknown", "healthy", "unhealthy"]),
  configIndex: external_exports.number().int().nonnegative().nullable().optional(),
  createdAt: external_exports.coerce.date(),
  updatedAt: external_exports.coerce.date()
}).strict();
var executionWorkspaceCloseReadinessSchema = external_exports.object({
  workspaceId: external_exports.string().uuid(),
  state: executionWorkspaceCloseReadinessStateSchema,
  blockingReasons: external_exports.array(external_exports.string()),
  warnings: external_exports.array(external_exports.string()),
  linkedIssues: external_exports.array(executionWorkspaceCloseLinkedIssueSchema),
  plannedActions: external_exports.array(executionWorkspaceCloseActionSchema),
  isDestructiveCloseAllowed: external_exports.boolean(),
  isSharedWorkspace: external_exports.boolean(),
  isProjectPrimaryWorkspace: external_exports.boolean(),
  git: executionWorkspaceCloseGitReadinessSchema.nullable(),
  runtimeServices: external_exports.array(workspaceRuntimeServiceSchema)
}).strict();
var updateExecutionWorkspaceSchema = external_exports.object({
  name: external_exports.string().min(1).optional(),
  cwd: external_exports.string().optional().nullable(),
  repoUrl: external_exports.string().optional().nullable(),
  baseRef: external_exports.string().optional().nullable(),
  branchName: external_exports.string().optional().nullable(),
  providerRef: external_exports.string().optional().nullable(),
  status: executionWorkspaceStatusSchema.optional(),
  cleanupEligibleAt: external_exports.string().datetime().optional().nullable(),
  cleanupReason: external_exports.string().optional().nullable(),
  config: executionWorkspaceConfigSchema.optional().nullable(),
  metadata: external_exports.record(external_exports.string(), external_exports.unknown()).optional().nullable()
}).strict();
var branchReconcileReasonSchema = external_exports.string().trim().min(1);
var reconcileExecutionWorkspaceBranchSchema = external_exports.discriminatedUnion("mode", [
  external_exports.object({
    mode: external_exports.literal("forward"),
    reason: branchReconcileReasonSchema.optional().nullable()
  }).strict(),
  external_exports.object({
    mode: external_exports.literal("override"),
    reason: branchReconcileReasonSchema
  }).strict(),
  external_exports.object({
    mode: external_exports.literal("quarantine_restore"),
    reason: branchReconcileReasonSchema.optional().nullable()
  }).strict()
]);

// ../../node_modules/.pnpm/@paperclipai+shared@2026.722.0/node_modules/@paperclipai/shared/dist/types/feedback.js
var FEEDBACK_TARGET_TYPES = ["issue_comment", "issue_document_revision"];
var FEEDBACK_VOTE_VALUES = ["up", "down"];
var FEEDBACK_DATA_SHARING_PREFERENCES = ["allowed", "not_allowed", "prompt"];
var DEFAULT_FEEDBACK_DATA_SHARING_PREFERENCE = "prompt";
var FEEDBACK_TRACE_STATUSES = ["local_only", "pending", "sent", "failed"];

// ../../node_modules/.pnpm/@paperclipai+shared@2026.722.0/node_modules/@paperclipai/shared/dist/validators/feedback.js
var feedbackTargetTypeSchema = external_exports.enum(FEEDBACK_TARGET_TYPES);
var feedbackTraceStatusSchema = external_exports.enum(FEEDBACK_TRACE_STATUSES);
var feedbackVoteValueSchema = external_exports.enum(FEEDBACK_VOTE_VALUES);
var feedbackDataSharingPreferenceSchema = external_exports.enum(FEEDBACK_DATA_SHARING_PREFERENCES);
var upsertIssueFeedbackVoteSchema = external_exports.object({
  targetType: feedbackTargetTypeSchema,
  targetId: external_exports.string().uuid(),
  vote: feedbackVoteValueSchema,
  reason: external_exports.string().trim().max(1e3).optional(),
  allowSharing: external_exports.boolean().optional()
});

// ../../node_modules/.pnpm/@paperclipai+shared@2026.722.0/node_modules/@paperclipai/shared/dist/validators/instance.js
function presetSchema(presets, label) {
  return external_exports.number().refine((v) => presets.includes(v), { message: `${label} must be one of: ${presets.join(", ")}` });
}
var backupRetentionPolicySchema = external_exports.object({
  dailyDays: presetSchema(DAILY_RETENTION_PRESETS, "dailyDays").default(DEFAULT_BACKUP_RETENTION.dailyDays),
  weeklyWeeks: presetSchema(WEEKLY_RETENTION_PRESETS, "weeklyWeeks").default(DEFAULT_BACKUP_RETENTION.weeklyWeeks),
  monthlyMonths: presetSchema(MONTHLY_RETENTION_PRESETS, "monthlyMonths").default(DEFAULT_BACKUP_RETENTION.monthlyMonths)
});
var instanceGeneralSettingsSchema = external_exports.object({
  censorUsernameInLogs: external_exports.boolean().default(false),
  keyboardShortcuts: external_exports.boolean().default(false),
  feedbackDataSharingPreference: feedbackDataSharingPreferenceSchema.default(DEFAULT_FEEDBACK_DATA_SHARING_PREFERENCE),
  backupRetention: backupRetentionPolicySchema.default(DEFAULT_BACKUP_RETENTION),
  // Execution policy. Absent/"any" = unrestricted; "kubernetes" forces the
  // Kubernetes sandbox provider and denies local/ssh execution (cloud_tenant).
  executionMode: external_exports.enum(["kubernetes", "any"]).optional()
}).strict();
var patchInstanceGeneralSettingsSchema = instanceGeneralSettingsSchema.partial();
var instanceExperimentalSettingsSchema = external_exports.object({
  enableEnvironments: external_exports.boolean().default(false),
  enableIsolatedWorkspaces: external_exports.boolean().default(false),
  enableStreamlinedLeftNavigation: external_exports.boolean().default(true),
  enableApps: external_exports.boolean().default(false),
  enablePipelines: external_exports.boolean().default(false),
  enableCases: external_exports.boolean().default(false),
  enableConferenceRoomChat: external_exports.boolean().default(false),
  enableTaskWatchdogs: external_exports.boolean().default(false),
  enableIssuePlanDecompositions: external_exports.boolean().default(false),
  enableExperimentalFileViewer: external_exports.boolean().default(false),
  enableCloudSync: external_exports.boolean().default(false),
  enableExternalObjects: external_exports.boolean().default(false),
  enableSmokeLab: external_exports.boolean().default(false),
  enableBuiltInAgents: external_exports.boolean().default(false),
  enableSummaries: external_exports.boolean().default(false),
  enableDecisions: external_exports.boolean().default(false),
  enableGoalsSidebarLink: external_exports.boolean().default(false),
  enableServerInfoDebugView: external_exports.boolean().default(false),
  autoRestartDevServerWhenIdle: external_exports.boolean().default(false),
  enableIssueGraphLivenessAutoRecovery: external_exports.boolean().default(false),
  enableWorkspaceBranchReconcileForward: external_exports.boolean().default(true),
  enableWorkspaceDirtyQuarantineRepair: external_exports.boolean().default(true),
  enableWorktreeRunExecution: external_exports.boolean().default(false),
  worktreeRunExecutionActivatedAt: external_exports.string().datetime().nullable().default(null),
  worktreeRunExecutionActivationInstanceId: external_exports.string().min(1).nullable().default(null),
  issueGraphLivenessAutoRecoveryLookbackHours: external_exports.number().int().min(MIN_ISSUE_GRAPH_LIVENESS_AUTO_RECOVERY_LOOKBACK_HOURS).max(MAX_ISSUE_GRAPH_LIVENESS_AUTO_RECOVERY_LOOKBACK_HOURS).default(DEFAULT_ISSUE_GRAPH_LIVENESS_AUTO_RECOVERY_LOOKBACK_HOURS)
}).strict();
var patchInstanceExperimentalSettingsSchema = instanceExperimentalSettingsSchema.omit({
  worktreeRunExecutionActivatedAt: true,
  worktreeRunExecutionActivationInstanceId: true
}).partial().strip();
var patchInstanceSettingsSchema = external_exports.object({
  defaultEnvironmentId: external_exports.string().uuid().nullable().optional()
}).strict();
var issueGraphLivenessAutoRecoveryRequestSchema = external_exports.object({
  lookbackHours: external_exports.number().int().min(MIN_ISSUE_GRAPH_LIVENESS_AUTO_RECOVERY_LOOKBACK_HOURS).max(MAX_ISSUE_GRAPH_LIVENESS_AUTO_RECOVERY_LOOKBACK_HOURS).optional()
}).strict();
var instanceSettingsSchema = external_exports.object({
  id: external_exports.string().uuid(),
  defaultEnvironmentId: external_exports.string().uuid().nullable(),
  general: instanceGeneralSettingsSchema,
  experimental: instanceExperimentalSettingsSchema,
  createdAt: external_exports.union([external_exports.date(), external_exports.string().datetime()]),
  updatedAt: external_exports.union([external_exports.date(), external_exports.string().datetime()])
}).strict();

// ../../node_modules/.pnpm/@paperclipai+shared@2026.722.0/node_modules/@paperclipai/shared/dist/validators/budget.js
var upsertBudgetPolicySchema = external_exports.object({
  scopeType: external_exports.enum(BUDGET_SCOPE_TYPES),
  scopeId: external_exports.string().uuid(),
  metric: external_exports.enum(BUDGET_METRICS).optional().default("billed_cents"),
  windowKind: external_exports.enum(BUDGET_WINDOW_KINDS).optional().default("calendar_month_utc"),
  amount: external_exports.number().int().nonnegative(),
  warnPercent: external_exports.number().int().min(1).max(99).optional().default(80),
  hardStopEnabled: external_exports.boolean().optional().default(true),
  notifyEnabled: external_exports.boolean().optional().default(true),
  isActive: external_exports.boolean().optional().default(true)
});
var resolveBudgetIncidentSchema = external_exports.object({
  action: external_exports.enum(BUDGET_INCIDENT_RESOLUTION_ACTIONS),
  amount: external_exports.number().int().nonnegative().optional(),
  decisionNote: external_exports.string().optional().nullable()
}).superRefine((value, ctx) => {
  if (value.action === "raise_budget_and_resume" && typeof value.amount !== "number") {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      message: "amount is required when raising a budget",
      path: ["amount"]
    });
  }
});

// ../../node_modules/.pnpm/@paperclipai+shared@2026.722.0/node_modules/@paperclipai/shared/dist/validators/smoke-lab.js
var smokeRunTriggerSchema = external_exports.enum(SMOKE_RUN_TRIGGERS);
var smokeRunStatusSchema = external_exports.enum(SMOKE_RUN_STATUSES);
var smokeRunStepPathSchema = external_exports.enum(SMOKE_RUN_STEP_PATHS);
var smokeRunStepStatusSchema = external_exports.enum(SMOKE_RUN_STEP_STATUSES);
var createSmokeRunSchema = external_exports.object({
  trigger: smokeRunTriggerSchema.default("manual"),
  summary: external_exports.record(external_exports.string(), external_exports.unknown()).default({})
}).strict();
var updateSmokeRunSchema = external_exports.object({
  status: smokeRunStatusSchema,
  summary: external_exports.record(external_exports.string(), external_exports.unknown()).optional()
}).strict();
var recordSmokeRunStepSchema = external_exports.object({
  path: smokeRunStepPathSchema,
  scenarioStep: external_exports.string().min(1).max(200),
  status: smokeRunStepStatusSchema,
  detail: external_exports.string().max(4e3).nullable().optional(),
  screenshotArtifactRef: external_exports.record(external_exports.string(), external_exports.unknown()).nullable().optional(),
  durationMs: external_exports.number().int().min(0).max(24 * 60 * 60 * 1e3).nullable().optional()
}).strict();

// ../../node_modules/.pnpm/@paperclipai+shared@2026.722.0/node_modules/@paperclipai/shared/dist/validators/company.js
var logoAssetIdSchema = external_exports.string().uuid().nullable().optional();
var brandColorSchema = external_exports.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional();
var feedbackDataSharingTermsVersionSchema = external_exports.string().min(1).nullable().optional();
var attachmentMaxBytesSchema = external_exports.number().int().min(1).max(MAX_COMPANY_ATTACHMENT_MAX_BYTES);
var createCompanySchema = external_exports.object({
  name: external_exports.string().min(1),
  description: external_exports.string().optional().nullable(),
  budgetMonthlyCents: external_exports.number().int().nonnegative().optional().default(0),
  attachmentMaxBytes: attachmentMaxBytesSchema.optional(),
  defaultResponsibleUserId: external_exports.string().min(1).nullable().optional()
});
var updateCompanySchema = createCompanySchema.partial().extend({
  status: external_exports.enum(COMPANY_STATUSES).optional(),
  spentMonthlyCents: external_exports.number().int().nonnegative().optional(),
  requireBoardApprovalForNewAgents: external_exports.boolean().optional(),
  feedbackDataSharingEnabled: external_exports.boolean().optional(),
  feedbackDataSharingConsentAt: external_exports.coerce.date().nullable().optional(),
  feedbackDataSharingConsentByUserId: external_exports.string().min(1).nullable().optional(),
  feedbackDataSharingTermsVersion: feedbackDataSharingTermsVersionSchema,
  brandColor: brandColorSchema,
  logoAssetId: logoAssetIdSchema,
  attachmentMaxBytes: attachmentMaxBytesSchema.optional()
});
var updateCompanyBrandingSchema = external_exports.object({
  name: external_exports.string().min(1).optional(),
  description: external_exports.string().nullable().optional(),
  brandColor: brandColorSchema,
  logoAssetId: logoAssetIdSchema
}).strict().refine((value) => value.name !== void 0 || value.description !== void 0 || value.brandColor !== void 0 || value.logoAssetId !== void 0, "At least one branding field must be provided");

// ../../node_modules/.pnpm/@paperclipai+shared@2026.722.0/node_modules/@paperclipai/shared/dist/validators/environment.js
var environmentDriverSchema = external_exports.enum(ENVIRONMENT_DRIVERS);
var environmentStatusSchema = external_exports.enum(ENVIRONMENT_STATUSES);
var environmentLeaseStatusSchema = external_exports.enum(ENVIRONMENT_LEASE_STATUSES);
var environmentLeaseCleanupStatusSchema = external_exports.enum(ENVIRONMENT_LEASE_CLEANUP_STATUSES);
var environmentFields = {
  name: external_exports.string().min(1),
  description: external_exports.string().optional().nullable(),
  driver: environmentDriverSchema,
  status: environmentStatusSchema.optional().default("active"),
  config: external_exports.record(external_exports.string(), external_exports.unknown()).optional().default({}),
  envVars: envConfigSchema.optional().default({}),
  metadata: external_exports.record(external_exports.string(), external_exports.unknown()).optional().nullable()
};
var createEnvironmentSchema = external_exports.object(environmentFields).strict();
var updateEnvironmentSchema = external_exports.object({
  name: external_exports.string().min(1).optional(),
  description: external_exports.string().optional().nullable(),
  driver: environmentDriverSchema.optional(),
  status: environmentStatusSchema.optional(),
  config: external_exports.record(external_exports.string(), external_exports.unknown()).optional(),
  envVars: envConfigSchema.optional(),
  metadata: external_exports.record(external_exports.string(), external_exports.unknown()).optional().nullable()
}).strict();
var probeEnvironmentConfigSchema = external_exports.object({
  name: external_exports.string().min(1).optional(),
  description: external_exports.string().optional().nullable(),
  driver: environmentDriverSchema,
  config: external_exports.record(external_exports.string(), external_exports.unknown()).optional().default({}),
  envVars: envConfigSchema.optional().default({}),
  metadata: external_exports.record(external_exports.string(), external_exports.unknown()).optional().nullable()
}).strict();

// ../../node_modules/.pnpm/@paperclipai+shared@2026.722.0/node_modules/@paperclipai/shared/dist/validators/environment-custom-images.js
var isoDateTime = external_exports.union([external_exports.date(), external_exports.string().datetime()]);
var providerKeySchema = external_exports.string().min(1).max(200);
var optionalRecordSchema = external_exports.record(external_exports.string(), external_exports.unknown()).optional().nullable();
var environmentCustomImageTemplateKindSchema = external_exports.enum(ENVIRONMENT_CUSTOM_IMAGE_TEMPLATE_KINDS);
var environmentCustomImageTemplateStatusSchema = external_exports.enum(ENVIRONMENT_CUSTOM_IMAGE_TEMPLATE_STATUSES);
var environmentCustomImageSetupSessionStatusSchema = external_exports.enum(ENVIRONMENT_CUSTOM_IMAGE_SETUP_SESSION_STATUSES);
var environmentCustomImageSetupConnectionTypeSchema = external_exports.enum(ENVIRONMENT_CUSTOM_IMAGE_SETUP_CONNECTION_TYPES);
var environmentCustomImageSetupConnectionSummarySchema = external_exports.object({
  type: environmentCustomImageSetupConnectionTypeSchema,
  username: external_exports.string().min(1).max(200).optional().nullable(),
  hostRedacted: external_exports.literal(true).optional().default(true),
  portRedacted: external_exports.literal(true).optional().default(true),
  label: external_exports.string().min(1).max(200).optional().nullable(),
  instructions: external_exports.string().min(1).max(1e3).optional().nullable()
}).strict();
var environmentCustomImageTemplateSchema = external_exports.object({
  id: external_exports.string().uuid(),
  environmentId: external_exports.string().uuid(),
  provider: providerKeySchema,
  templateKind: environmentCustomImageTemplateKindSchema,
  templateRef: external_exports.string().min(1).nullable(),
  sourceTemplateRef: external_exports.string().min(1).nullable(),
  sourceEnvironmentConfigFingerprint: external_exports.string().min(1).nullable(),
  status: environmentCustomImageTemplateStatusSchema,
  createdByUserId: external_exports.string().min(1).nullable(),
  createdByAgentId: external_exports.string().uuid().nullable(),
  capturedAt: isoDateTime.nullable(),
  lastUsedAt: isoDateTime.nullable(),
  supersededByTemplateId: external_exports.string().uuid().nullable(),
  metadata: optionalRecordSchema,
  createdAt: isoDateTime,
  updatedAt: isoDateTime
}).strict();
var environmentCustomImageSetupSessionSchema = external_exports.object({
  id: external_exports.string().uuid(),
  environmentId: external_exports.string().uuid(),
  templateId: external_exports.string().uuid().nullable(),
  promotedTemplateId: external_exports.string().uuid().nullable(),
  provider: providerKeySchema,
  providerLeaseId: external_exports.string().min(1).nullable(),
  environmentLeaseId: external_exports.string().uuid().nullable(),
  status: environmentCustomImageSetupSessionStatusSchema,
  startedByUserId: external_exports.string().min(1).nullable(),
  startedByAgentId: external_exports.string().uuid().nullable(),
  baseTemplateRef: external_exports.string().min(1).nullable(),
  expiresAt: isoDateTime.nullable(),
  finishedAt: isoDateTime.nullable(),
  failureReason: external_exports.string().min(1).nullable(),
  connectionSummary: environmentCustomImageSetupConnectionSummarySchema.nullable(),
  connectionSecretRef: external_exports.string().min(1).nullable(),
  metadata: optionalRecordSchema,
  createdAt: isoDateTime,
  updatedAt: isoDateTime
}).strict();
var startEnvironmentCustomImageSetupSessionSchema = external_exports.object({
  templateId: external_exports.string().uuid().optional().nullable(),
  ttlSeconds: external_exports.number().int().min(60).max(24 * 60 * 60).optional()
}).strict();
var finishEnvironmentCustomImageSetupSessionSchema = external_exports.object({
  metadata: external_exports.record(external_exports.string(), external_exports.unknown()).optional()
}).strict();
var cancelEnvironmentCustomImageSetupSessionSchema = external_exports.object({
  reason: external_exports.string().min(1).max(1e3).optional()
}).strict();
var createEnvironmentCustomImageTerminalSessionTokenSchema = external_exports.object({}).strict().default({});
var environmentCustomImageTerminalSessionTokenSchema = external_exports.object({
  id: external_exports.string().min(1),
  token: external_exports.string().min(32),
  expiresAt: isoDateTime,
  setupSessionId: external_exports.string().min(1),
  environmentId: external_exports.string().min(1),
  connectionType: external_exports.literal("ssh"),
  websocketPath: external_exports.string().min(1)
}).strict();

// ../../node_modules/.pnpm/@paperclipai+shared@2026.722.0/node_modules/@paperclipai/shared/dist/validators/company-skill.js
var companySkillSourceTypeSchema = external_exports.enum(["local_path", "github", "url", "catalog", "skills_sh"]);
var companySkillTrustLevelSchema = external_exports.enum(["markdown_only", "assets", "scripts_executables"]);
var companySkillCompatibilitySchema = external_exports.enum(["compatible", "unknown", "invalid"]);
var companySkillSourceBadgeSchema = external_exports.enum(["paperclip", "github", "local", "url", "catalog", "skills_sh"]);
var companySkillSharingScopeSchema = external_exports.enum(["private", "company", "public_link"]);
var companySkillListSortSchema = external_exports.enum(["alphabetical", "recent", "installs", "stars", "agents", "forks"]);
var companySkillListIncludeSchema = external_exports.enum(["lastEditor"]);
var companySkillFileInventoryEntrySchema = external_exports.object({
  path: external_exports.string().min(1),
  kind: external_exports.enum(["skill", "markdown", "reference", "script", "asset", "other"])
});
var companySkillVersionFileInventoryEntrySchema = companySkillFileInventoryEntrySchema.extend({
  content: external_exports.string()
});
var companySkillSchema = external_exports.object({
  id: external_exports.string().uuid(),
  companyId: external_exports.string().uuid(),
  folderId: external_exports.string().uuid().nullable().optional(),
  folderPath: external_exports.string().nullable().optional(),
  key: external_exports.string().min(1),
  slug: external_exports.string().min(1),
  name: external_exports.string().min(1),
  description: external_exports.string().nullable(),
  markdown: external_exports.string(),
  sourceType: companySkillSourceTypeSchema,
  sourceLocator: external_exports.string().nullable(),
  sourceRef: external_exports.string().nullable(),
  trustLevel: companySkillTrustLevelSchema,
  compatibility: companySkillCompatibilitySchema,
  fileInventory: external_exports.array(companySkillFileInventoryEntrySchema).default([]),
  iconUrl: external_exports.string().nullable(),
  color: external_exports.string().nullable(),
  tagline: external_exports.string().nullable(),
  authorName: external_exports.string().nullable(),
  homepageUrl: external_exports.string().nullable(),
  categories: external_exports.array(external_exports.string().min(1)).default([]),
  sharingScope: companySkillSharingScopeSchema,
  publicShareToken: external_exports.string().nullable(),
  forkedFromSkillId: external_exports.string().uuid().nullable(),
  forkedFromCompanyId: external_exports.string().uuid().nullable(),
  starCount: external_exports.number().int().nonnegative(),
  installCount: external_exports.number().int().nonnegative(),
  forkCount: external_exports.number().int().nonnegative(),
  currentVersionId: external_exports.string().uuid().nullable(),
  metadata: external_exports.record(external_exports.string(), external_exports.unknown()).nullable(),
  createdAt: external_exports.coerce.date(),
  updatedAt: external_exports.coerce.date()
});
var companySkillListItemSchema = companySkillSchema.extend({
  attachedAgentCount: external_exports.number().int().nonnegative(),
  editable: external_exports.boolean(),
  editableReason: external_exports.string().nullable(),
  sourceLabel: external_exports.string().nullable(),
  sourceBadge: companySkillSourceBadgeSchema,
  catalogKind: external_exports.enum(["bundled", "optional"]).nullable(),
  originHash: external_exports.string().nullable(),
  packageName: external_exports.string().nullable(),
  packageVersion: external_exports.string().nullable(),
  lastEditor: external_exports.object({
    kind: external_exports.enum(["user", "agent"]),
    id: external_exports.string().min(1),
    name: external_exports.string().nullable(),
    imageUrl: external_exports.string().nullable()
  }).nullable().optional()
});
var companySkillUsageAgentSchema = external_exports.object({
  id: external_exports.string().uuid(),
  name: external_exports.string().min(1),
  urlKey: external_exports.string().min(1),
  adapterType: external_exports.string().min(1),
  desired: external_exports.boolean(),
  actualState: external_exports.string().nullable().describe("Runtime adapter skill state when explicitly fetched; company skill detail reads return null without probing agent runtimes."),
  versionId: external_exports.string().uuid().nullable()
});
var companySkillOriginalSummarySchema = external_exports.object({
  id: external_exports.string().uuid(),
  name: external_exports.string().min(1),
  slug: external_exports.string().min(1),
  sourceType: companySkillSourceTypeSchema,
  sourceLocator: external_exports.string().nullable(),
  sourceRef: external_exports.string().nullable()
});
var companySkillForkSummarySchema = companySkillOriginalSummarySchema.extend({
  key: external_exports.string().min(1),
  forkedFromSkillId: external_exports.string().uuid().nullable(),
  forkedFromCompanyId: external_exports.string().uuid().nullable(),
  currentVersionId: external_exports.string().uuid().nullable(),
  createdByCurrentActor: external_exports.boolean(),
  diverged: external_exports.boolean(),
  createdAt: external_exports.coerce.date(),
  updatedAt: external_exports.coerce.date()
});
var companySkillListQuerySchema = external_exports.object({
  q: external_exports.string().min(1).optional(),
  sort: companySkillListSortSchema.optional(),
  categories: external_exports.array(external_exports.string().min(1)).optional(),
  scope: companySkillSharingScopeSchema.optional(),
  include: external_exports.array(companySkillListIncludeSchema).optional(),
  folderId: external_exports.string().uuid().optional(),
  includeSubtree: external_exports.boolean().optional()
});
var companySkillCategoryCountSchema = external_exports.object({
  slug: external_exports.string().min(1),
  count: external_exports.number().int().nonnegative()
});
var companySkillVersionSchema = external_exports.object({
  id: external_exports.string().uuid(),
  companyId: external_exports.string().uuid(),
  companySkillId: external_exports.string().uuid(),
  revisionNumber: external_exports.number().int().positive(),
  label: external_exports.string().nullable(),
  fileInventory: external_exports.array(companySkillVersionFileInventoryEntrySchema).default([]),
  authorAgentId: external_exports.string().uuid().nullable(),
  authorUserId: external_exports.string().nullable(),
  createdAt: external_exports.coerce.date()
});
var companySkillDetailSchema = companySkillSchema.extend({
  attachedAgentCount: external_exports.number().int().nonnegative(),
  usedByAgents: external_exports.array(companySkillUsageAgentSchema).default([]),
  existingForks: external_exports.array(companySkillForkSummarySchema).default([]),
  editable: external_exports.boolean(),
  editableReason: external_exports.string().nullable(),
  sourceLabel: external_exports.string().nullable(),
  sourceBadge: companySkillSourceBadgeSchema,
  currentVersion: companySkillVersionSchema.nullable(),
  starredByCurrentActor: external_exports.boolean()
});
var companySkillVersionCreateSchema = external_exports.object({
  label: external_exports.string().trim().min(1).nullable().optional()
}).default({});
var companySkillStarResultSchema = external_exports.object({
  skillId: external_exports.string().uuid(),
  starred: external_exports.boolean(),
  starCount: external_exports.number().int().nonnegative()
});
var companySkillCommentSchema = external_exports.object({
  id: external_exports.string().uuid(),
  companyId: external_exports.string().uuid(),
  companySkillId: external_exports.string().uuid(),
  parentCommentId: external_exports.string().uuid().nullable(),
  authorAgentId: external_exports.string().uuid().nullable(),
  authorUserId: external_exports.string().nullable(),
  body: external_exports.string(),
  deletedAt: external_exports.coerce.date().nullable(),
  createdAt: external_exports.coerce.date(),
  updatedAt: external_exports.coerce.date()
});
var companySkillCommentCreateSchema = external_exports.object({
  body: external_exports.string().min(1),
  parentCommentId: external_exports.string().uuid().nullable().optional()
});
var companySkillCommentUpdateSchema = external_exports.object({
  body: external_exports.string().min(1)
});
var companySkillForkSchema = external_exports.object({
  name: external_exports.string().min(1).nullable().optional(),
  slug: external_exports.string().min(1).nullable().optional(),
  sharingScope: companySkillSharingScopeSchema.optional(),
  reassignAgentIds: external_exports.array(external_exports.string().uuid()).optional()
}).default({});
var companySkillForkReassignmentSchema = external_exports.object({
  agentId: external_exports.string().uuid(),
  previousSkillKey: external_exports.string().min(1),
  nextSkillKey: external_exports.string().min(1)
});
var companySkillForkResultSchema = external_exports.object({
  skill: companySkillSchema,
  original: companySkillOriginalSummarySchema,
  reassignments: external_exports.array(companySkillForkReassignmentSchema)
});
var companySkillForkPrecheckResultSchema = external_exports.object({
  skillId: external_exports.string().uuid(),
  original: companySkillOriginalSummarySchema,
  agentUsageCount: external_exports.number().int().nonnegative(),
  usedByAgents: external_exports.array(companySkillUsageAgentSchema),
  existingForks: external_exports.array(companySkillForkSummarySchema)
});
var companySkillUpdateSchema = external_exports.object({
  description: external_exports.string().nullable().optional(),
  iconUrl: external_exports.string().nullable().optional(),
  color: external_exports.string().nullable().optional(),
  tagline: external_exports.string().max(120).nullable().optional(),
  authorName: external_exports.string().nullable().optional(),
  homepageUrl: external_exports.string().nullable().optional(),
  categories: external_exports.array(external_exports.string().min(1)).optional(),
  sharingScope: companySkillSharingScopeSchema.optional()
}).default({});
var companySkillUpdateStatusSchema = external_exports.object({
  supported: external_exports.boolean(),
  reason: external_exports.string().nullable(),
  trackingRef: external_exports.string().nullable(),
  currentRef: external_exports.string().nullable(),
  latestRef: external_exports.string().nullable(),
  hasUpdate: external_exports.boolean(),
  installedHash: external_exports.string().nullable(),
  originHash: external_exports.string().nullable(),
  userModifiedAt: external_exports.string().nullable(),
  updateHoldReason: external_exports.enum([
    "local_modifications",
    "audit_hard_stop",
    "origin_unavailable",
    "compatibility_invalid",
    "operator_hold"
  ]).nullable(),
  auditVerdict: external_exports.enum(["pass", "warning", "fail"]).nullable(),
  auditCodes: external_exports.array(external_exports.string())
});
var companySkillAuditFindingSchema = external_exports.object({
  code: external_exports.string().min(1),
  severity: external_exports.enum(["warning", "error"]),
  message: external_exports.string().min(1),
  path: external_exports.string().nullable()
});
var companySkillAuditResultSchema = external_exports.object({
  skillId: external_exports.string().uuid(),
  installedHash: external_exports.string().nullable(),
  originHash: external_exports.string().nullable(),
  verdict: external_exports.enum(["pass", "warning", "fail"]),
  codes: external_exports.array(external_exports.string()),
  findings: external_exports.array(companySkillAuditFindingSchema),
  scannedAt: external_exports.string().min(1),
  scanVersion: external_exports.string().min(1)
});
var companySkillInstallUpdateSchema = external_exports.object({
  force: external_exports.boolean().optional()
}).default({});
var companySkillResetSchema = external_exports.object({
  force: external_exports.boolean().optional()
}).default({});
var companySkillImportSchema = external_exports.object({
  source: external_exports.string().min(1)
});
var companySkillProjectScanRequestSchema = external_exports.object({
  projectIds: external_exports.array(external_exports.string().uuid()).optional(),
  workspaceIds: external_exports.array(external_exports.string().uuid()).optional(),
  mode: external_exports.enum(["import", "preview"]).optional(),
  selection: external_exports.array(external_exports.object({
    workspaceId: external_exports.string().uuid(),
    path: external_exports.string().min(1),
    slug: external_exports.string().min(1).optional()
  })).optional()
});
var companySkillProjectScanCandidateSchema = external_exports.object({
  slug: external_exports.string().min(1),
  name: external_exports.string().min(1),
  description: external_exports.string().nullable(),
  workspaceId: external_exports.string().uuid(),
  workspaceName: external_exports.string().min(1),
  projectId: external_exports.string().uuid(),
  projectName: external_exports.string().min(1),
  directoryRoot: external_exports.string().min(1),
  relativePath: external_exports.string().min(1),
  status: external_exports.enum(["new", "already_imported", "conflict", "skipped"]),
  existingSkillId: external_exports.string().uuid().optional(),
  reason: external_exports.string().min(1).optional()
});
var companySkillProjectScanSkippedSchema = external_exports.object({
  projectId: external_exports.string().uuid().nullable(),
  projectName: external_exports.string().min(1).nullable(),
  workspaceId: external_exports.string().uuid().nullable(),
  workspaceName: external_exports.string().nullable(),
  path: external_exports.string().nullable(),
  reason: external_exports.string().min(1)
});
var companySkillProjectScanConflictSchema = external_exports.object({
  slug: external_exports.string().min(1),
  key: external_exports.string().min(1),
  projectId: external_exports.string().uuid(),
  projectName: external_exports.string().min(1),
  workspaceId: external_exports.string().uuid(),
  workspaceName: external_exports.string().min(1),
  path: external_exports.string().min(1),
  existingSkillId: external_exports.string().uuid(),
  existingSkillKey: external_exports.string().min(1),
  existingSourceLocator: external_exports.string().nullable(),
  reason: external_exports.string().min(1)
});
var companySkillProjectScanResultSchema = external_exports.object({
  scannedProjects: external_exports.number().int().nonnegative(),
  scannedWorkspaces: external_exports.number().int().nonnegative(),
  discovered: external_exports.number().int().nonnegative(),
  imported: external_exports.array(companySkillSchema),
  updated: external_exports.array(companySkillSchema),
  skipped: external_exports.array(companySkillProjectScanSkippedSchema),
  conflicts: external_exports.array(companySkillProjectScanConflictSchema),
  candidates: external_exports.array(companySkillProjectScanCandidateSchema),
  warnings: external_exports.array(external_exports.string())
});
var companySkillCreateSchema = external_exports.object({
  folderId: external_exports.string().uuid().nullable().optional(),
  name: external_exports.string().min(1),
  slug: external_exports.string().min(1).nullable().optional(),
  description: external_exports.string().nullable().optional(),
  markdown: external_exports.string().nullable().optional(),
  iconUrl: external_exports.string().nullable().optional(),
  color: external_exports.string().nullable().optional(),
  tagline: external_exports.string().max(120).nullable().optional(),
  authorName: external_exports.string().nullable().optional(),
  homepageUrl: external_exports.string().nullable().optional(),
  categories: external_exports.array(external_exports.string().min(1)).optional(),
  sharingScope: companySkillSharingScopeSchema.optional(),
  forkedFromSkillId: external_exports.string().uuid().nullable().optional()
});
var companySkillFileDetailSchema = external_exports.object({
  skillId: external_exports.string().uuid(),
  path: external_exports.string().min(1),
  kind: external_exports.enum(["skill", "markdown", "reference", "script", "asset", "other"]),
  content: external_exports.string(),
  language: external_exports.string().nullable(),
  markdown: external_exports.boolean(),
  editable: external_exports.boolean()
});
var companySkillFileUpdateSchema = external_exports.object({
  path: external_exports.string().min(1),
  content: external_exports.string()
});
var companySkillFileDeleteSchema = external_exports.object({
  path: external_exports.string().min(1),
  target: external_exports.enum(["file", "folder"])
});
var companySkillTestRunStatusSchema = external_exports.enum(["queued", "running", "succeeded", "failed", "cancelled"]);
var companySkillTestInputSchema = external_exports.object({
  id: external_exports.string().uuid(),
  companyId: external_exports.string().uuid(),
  skillId: external_exports.string().uuid(),
  name: external_exports.string().min(1),
  content: external_exports.string(),
  createdBy: external_exports.string().nullable(),
  deletedAt: external_exports.coerce.date().nullable(),
  createdAt: external_exports.coerce.date(),
  updatedAt: external_exports.coerce.date()
});
var companySkillTestInputCreateSchema = external_exports.object({
  name: external_exports.string().trim().min(1),
  content: external_exports.string().min(1)
});
var companySkillTestInputUpdateSchema = external_exports.object({
  name: external_exports.string().trim().min(1).optional(),
  content: external_exports.string().min(1).optional()
}).refine((value) => value.name !== void 0 || value.content !== void 0, {
  message: "At least one field is required"
});
var companySkillTestRunTemplateSchema = external_exports.object({
  id: external_exports.string().min(1),
  companyId: external_exports.string().uuid(),
  name: external_exports.string().min(1),
  description: external_exports.string().nullable(),
  body: external_exports.string().min(1),
  builtIn: external_exports.boolean(),
  createdByAgentId: external_exports.string().uuid().nullable(),
  createdByUserId: external_exports.string().nullable(),
  updatedByAgentId: external_exports.string().uuid().nullable(),
  updatedByUserId: external_exports.string().nullable(),
  deletedAt: external_exports.coerce.date().nullable(),
  createdAt: external_exports.coerce.date(),
  updatedAt: external_exports.coerce.date()
});
var companySkillTestRunTemplateCreateSchema = external_exports.object({
  name: external_exports.string().trim().min(1).max(120),
  description: external_exports.string().trim().max(500).nullable().optional(),
  body: external_exports.string().min(1).max(2e4)
});
var companySkillTestRunTemplateUpdateSchema = external_exports.object({
  name: external_exports.string().trim().min(1).max(120).optional(),
  description: external_exports.string().trim().max(500).nullable().optional(),
  body: external_exports.string().min(1).max(2e4).optional()
}).refine((value) => value.name !== void 0 || value.description !== void 0 || value.body !== void 0, { message: "At least one field is required" });
var companySkillTestRunTemplateSnapshotSchema = external_exports.object({
  templateId: external_exports.string().min(1).nullable(),
  templateName: external_exports.string().min(1).nullable(),
  templateBody: external_exports.string().min(1).max(2e4).nullable()
}).refine((value) => value.templateId === null && value.templateName === null && value.templateBody === null || value.templateId !== null && value.templateName !== null && value.templateBody !== null, { message: "Template snapshot must be all null or include id, name, and body" });
var companySkillTestRunCostSummarySchema = external_exports.object({
  costCents: external_exports.number().int().nonnegative(),
  inputTokens: external_exports.number().int().nonnegative(),
  cachedInputTokens: external_exports.number().int().nonnegative(),
  outputTokens: external_exports.number().int().nonnegative()
});
var companySkillTestRunSchema = external_exports.object({
  id: external_exports.string().uuid(),
  companyId: external_exports.string().uuid(),
  skillId: external_exports.string().uuid(),
  inputId: external_exports.string().uuid().nullable(),
  inputSnapshot: external_exports.string(),
  skillVersionId: external_exports.string().uuid(),
  agentId: external_exports.string().uuid(),
  agentConfigSnapshot: external_exports.record(external_exports.string(), external_exports.unknown()),
  issueId: external_exports.string().uuid(),
  templateId: external_exports.string().nullable(),
  templateName: external_exports.string().nullable(),
  templateBody: external_exports.string().nullable(),
  renderedTemplateBody: external_exports.string().nullable(),
  harnessIssueDescription: external_exports.string(),
  status: companySkillTestRunStatusSchema,
  outputDocumentKey: external_exports.string().min(1),
  outputSnapshot: external_exports.string(),
  error: external_exports.string().nullable(),
  deletedAt: external_exports.coerce.date().nullable(),
  supersededAt: external_exports.coerce.date().nullable(),
  harnessIssueExpiresAt: external_exports.coerce.date().nullable(),
  harnessIssueDeletedAt: external_exports.coerce.date().nullable(),
  createdAt: external_exports.coerce.date(),
  updatedAt: external_exports.coerce.date(),
  cost: companySkillTestRunCostSummarySchema,
  taskExpired: external_exports.boolean()
});
var companySkillTestRunCreateSchema = external_exports.object({
  inputId: external_exports.string().uuid().nullable().optional(),
  content: external_exports.string().min(1).nullable().optional(),
  agentId: external_exports.string().uuid(),
  templateId: external_exports.string().min(1).nullable().optional(),
  templateSnapshot: companySkillTestRunTemplateSnapshotSchema.nullable().optional(),
  // Re-run pins the viewed run's skill version instead of the live head, so the
  // new run reproduces the same snapshots (golden-path step 5).
  skillVersionId: external_exports.string().uuid().nullable().optional()
}).refine((value) => Boolean(value.inputId) || Boolean(value.content?.trim()), {
  message: "inputId or content is required"
});
var companySkillTestRunListQuerySchema = external_exports.object({
  inputId: external_exports.string().uuid().optional()
});
var catalogSkillKindSchema = external_exports.enum(["bundled", "optional"]);
var catalogSkillFileSchema = external_exports.object({
  path: external_exports.string().min(1),
  kind: external_exports.enum(["skill", "markdown", "reference", "script", "asset", "other"]),
  sizeBytes: external_exports.number().int().nonnegative(),
  sha256: external_exports.string().min(1)
});
var catalogSkillGitHubSourceSchema = external_exports.object({
  type: external_exports.literal("github"),
  hostname: external_exports.string().min(1),
  owner: external_exports.string().min(1),
  repo: external_exports.string().min(1),
  ref: external_exports.string().min(1),
  commit: external_exports.string().regex(/^[0-9a-f]{40}$/i),
  path: external_exports.string(),
  url: external_exports.string().url()
});
var catalogSkillSourceSchema = catalogSkillGitHubSourceSchema;
var catalogSkillSchema = external_exports.object({
  id: external_exports.string().min(1),
  key: external_exports.string().min(1),
  kind: catalogSkillKindSchema,
  category: external_exports.string().min(1),
  slug: external_exports.string().min(1),
  name: external_exports.string().min(1),
  description: external_exports.string(),
  path: external_exports.string().min(1),
  entrypoint: external_exports.literal("SKILL.md"),
  trustLevel: companySkillTrustLevelSchema,
  compatibility: companySkillCompatibilitySchema,
  defaultInstall: external_exports.boolean(),
  recommendedForRoles: external_exports.array(external_exports.string()),
  requires: external_exports.array(external_exports.string()),
  tags: external_exports.array(external_exports.string()),
  files: external_exports.array(catalogSkillFileSchema),
  contentHash: external_exports.string().min(1),
  source: catalogSkillSourceSchema.optional(),
  packageName: external_exports.string().min(1).optional(),
  packageVersion: external_exports.string().min(1).optional()
});
var catalogSkillListQuerySchema = external_exports.object({
  kind: catalogSkillKindSchema.optional(),
  category: external_exports.string().min(1).optional(),
  q: external_exports.string().min(1).optional()
});
var catalogSkillFileDetailSchema = external_exports.object({
  catalogSkillId: external_exports.string().min(1),
  path: external_exports.string().min(1),
  kind: external_exports.enum(["skill", "markdown", "reference", "script", "asset", "other"]),
  content: external_exports.string(),
  language: external_exports.string().nullable(),
  markdown: external_exports.boolean()
});
var companySkillInstallCatalogSchema = external_exports.object({
  catalogSkillId: external_exports.string().min(1),
  slug: external_exports.string().min(1).nullable().optional(),
  force: external_exports.boolean().optional()
});
var companySkillInstallCatalogResultSchema = external_exports.object({
  action: external_exports.enum(["created", "updated", "unchanged"]),
  skill: companySkillSchema,
  catalogSkill: catalogSkillSchema,
  warnings: external_exports.array(external_exports.string())
});

// ../../node_modules/.pnpm/@paperclipai+shared@2026.722.0/node_modules/@paperclipai/shared/dist/validators/folder.js
var folderKindSchema = external_exports.enum(["routine", "skill"]);
var folderSlugSchema = external_exports.string().trim().min(1).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Folder slug must contain only lowercase letters, numbers, and single hyphens");
var folderSchema = external_exports.object({
  id: external_exports.string().uuid(),
  companyId: external_exports.string().uuid(),
  kind: folderKindSchema,
  parentId: external_exports.string().uuid().nullable(),
  name: external_exports.string().min(1),
  slug: folderSlugSchema,
  systemKey: external_exports.string().nullable(),
  path: external_exports.string().min(1),
  depth: external_exports.number().int().min(1),
  color: external_exports.string().nullable(),
  position: external_exports.number().int(),
  createdAt: external_exports.coerce.date(),
  updatedAt: external_exports.coerce.date()
});
var folderListItemSchema = folderSchema.extend({
  itemCount: external_exports.number().int().nonnegative()
});
var folderListResultSchema = external_exports.object({
  kind: folderKindSchema,
  folders: external_exports.array(folderListItemSchema),
  allCount: external_exports.number().int().nonnegative(),
  unfiledCount: external_exports.number().int().nonnegative()
});
var createFolderSchema = external_exports.object({
  kind: folderKindSchema,
  parentId: external_exports.string().uuid().optional().nullable(),
  name: external_exports.string().trim().min(1).max(120),
  slug: folderSlugSchema.optional().nullable(),
  color: external_exports.string().trim().min(1).max(80).optional().nullable(),
  position: external_exports.number().int().min(0).optional().nullable()
});
var updateFolderSchema = external_exports.object({
  name: external_exports.string().trim().min(1).max(120).optional(),
  slug: folderSlugSchema.optional(),
  color: external_exports.string().trim().min(1).max(80).optional().nullable(),
  position: external_exports.number().int().min(0).optional()
}).refine((value) => Object.keys(value).length > 0, {
  message: "At least one folder field is required"
});
var moveFolderSchema = external_exports.object({
  parentId: external_exports.string().uuid().optional().nullable(),
  position: external_exports.number().int().min(0)
});
var ensureMySkillFolderSchema = external_exports.object({
  slug: folderSlugSchema.optional().nullable()
}).default({});
var moveFolderItemSchema = external_exports.object({
  kind: folderKindSchema,
  itemId: external_exports.string().uuid(),
  folderId: external_exports.string().uuid().optional().nullable()
});

// ../../node_modules/.pnpm/@paperclipai+shared@2026.722.0/node_modules/@paperclipai/shared/dist/validators/company-portability.js
var portabilityIncludeSchema = external_exports.object({
  company: external_exports.boolean().optional(),
  agents: external_exports.boolean().optional(),
  projects: external_exports.boolean().optional(),
  issues: external_exports.boolean().optional(),
  skills: external_exports.boolean().optional()
}).partial();
var portabilityEnvInputSchema = external_exports.object({
  key: external_exports.string().min(1),
  description: external_exports.string().nullable(),
  agentSlug: external_exports.string().min(1).nullable(),
  projectSlug: external_exports.string().min(1).nullable(),
  kind: external_exports.enum(["secret", "plain"]),
  requirement: external_exports.enum(["required", "optional"]),
  defaultValue: external_exports.string().nullable(),
  portability: external_exports.enum(["portable", "system_dependent"])
});
var portabilityFileEntrySchema = external_exports.union([
  external_exports.string(),
  external_exports.object({
    encoding: external_exports.literal("base64"),
    data: external_exports.string(),
    contentType: external_exports.string().min(1).optional().nullable()
  })
]);
var portabilityCompanyManifestEntrySchema = external_exports.object({
  path: external_exports.string().min(1),
  name: external_exports.string().min(1),
  description: external_exports.string().nullable(),
  brandColor: external_exports.string().nullable(),
  logoPath: external_exports.string().nullable(),
  attachmentMaxBytes: external_exports.number().int().min(1).max(MAX_COMPANY_ATTACHMENT_MAX_BYTES).nullable().default(null),
  requireBoardApprovalForNewAgents: external_exports.boolean(),
  feedbackDataSharingEnabled: external_exports.boolean().default(false),
  feedbackDataSharingConsentAt: external_exports.string().datetime().nullable().default(null),
  feedbackDataSharingConsentByUserId: external_exports.string().nullable().default(null),
  feedbackDataSharingTermsVersion: external_exports.string().nullable().default(null)
});
var portabilitySidebarOrderSchema = external_exports.object({
  agents: external_exports.array(external_exports.string().min(1)).default([]),
  projects: external_exports.array(external_exports.string().min(1)).default([])
});
var portabilityAgentManifestEntrySchema = external_exports.object({
  slug: external_exports.string().min(1),
  name: external_exports.string().min(1),
  path: external_exports.string().min(1),
  skills: external_exports.array(external_exports.string().min(1)).default([]),
  role: external_exports.string().min(1),
  title: external_exports.string().nullable(),
  icon: external_exports.string().nullable(),
  capabilities: external_exports.string().nullable(),
  reportsToSlug: external_exports.string().min(1).nullable(),
  adapterType: external_exports.string().min(1),
  adapterConfig: external_exports.record(external_exports.string(), external_exports.unknown()),
  runtimeConfig: external_exports.record(external_exports.string(), external_exports.unknown()),
  permissions: external_exports.record(external_exports.string(), external_exports.unknown()),
  permissionGrants: external_exports.array(external_exports.object({
    permissionKey: external_exports.enum(PERMISSION_KEYS),
    scope: external_exports.record(external_exports.string(), external_exports.unknown()).nullable().default(null)
  })).default([]),
  budgetMonthlyCents: external_exports.number().int().nonnegative(),
  metadata: external_exports.record(external_exports.string(), external_exports.unknown()).nullable()
});
var portabilitySkillManifestEntrySchema = external_exports.object({
  key: external_exports.string().min(1),
  slug: external_exports.string().min(1),
  name: external_exports.string().min(1),
  path: external_exports.string().min(1),
  description: external_exports.string().nullable(),
  sourceType: external_exports.string().min(1),
  sourceLocator: external_exports.string().nullable(),
  sourceRef: external_exports.string().nullable(),
  trustLevel: external_exports.string().nullable(),
  compatibility: external_exports.string().nullable(),
  metadata: external_exports.record(external_exports.string(), external_exports.unknown()).nullable(),
  fileInventory: external_exports.array(external_exports.object({
    path: external_exports.string().min(1),
    kind: external_exports.string().min(1)
  })).default([])
});
var portabilityProjectManifestEntrySchema = external_exports.object({
  slug: external_exports.string().min(1),
  name: external_exports.string().min(1),
  path: external_exports.string().min(1),
  description: external_exports.string().nullable(),
  ownerAgentSlug: external_exports.string().min(1).nullable(),
  leadAgentSlug: external_exports.string().min(1).nullable(),
  targetDate: external_exports.string().nullable(),
  color: external_exports.string().nullable(),
  status: external_exports.string().nullable(),
  executionWorkspacePolicy: external_exports.record(external_exports.string(), external_exports.unknown()).nullable(),
  workspaces: external_exports.array(external_exports.object({
    key: external_exports.string().min(1),
    name: external_exports.string().min(1),
    sourceType: external_exports.string().nullable(),
    repoUrl: external_exports.string().nullable(),
    repoRef: external_exports.string().nullable(),
    defaultRef: external_exports.string().nullable(),
    visibility: external_exports.string().nullable(),
    setupCommand: external_exports.string().nullable(),
    cleanupCommand: external_exports.string().nullable(),
    metadata: external_exports.record(external_exports.string(), external_exports.unknown()).nullable(),
    isPrimary: external_exports.boolean()
  })).default([]),
  metadata: external_exports.record(external_exports.string(), external_exports.unknown()).nullable()
});
var portabilityIssueRoutineTriggerManifestEntrySchema = external_exports.object({
  kind: external_exports.string().min(1),
  label: external_exports.string().nullable(),
  enabled: external_exports.boolean(),
  cronExpression: external_exports.string().nullable(),
  timezone: external_exports.string().nullable(),
  signingMode: external_exports.string().nullable(),
  replayWindowSec: external_exports.number().int().nullable()
});
var portabilityIssueRoutineManifestEntrySchema = external_exports.object({
  concurrencyPolicy: external_exports.string().nullable(),
  catchUpPolicy: external_exports.string().nullable(),
  variables: external_exports.array(routineVariableSchema).nullable().optional(),
  triggers: external_exports.array(portabilityIssueRoutineTriggerManifestEntrySchema).default([])
});
var portabilityIssueCommentManifestEntrySchema = external_exports.object({
  body: external_exports.string().min(1),
  authorType: issueCommentAuthorTypeSchema,
  authorAgentSlug: external_exports.string().min(1).nullable(),
  authorUserId: external_exports.string().nullable(),
  presentation: issueCommentPresentationSchema.nullable(),
  metadata: issueCommentMetadataSchema.nullable(),
  createdAt: external_exports.string().datetime().nullable()
});
var portabilityIssueManifestEntrySchema = external_exports.object({
  slug: external_exports.string().min(1),
  identifier: external_exports.string().min(1).nullable(),
  title: external_exports.string().min(1),
  path: external_exports.string().min(1),
  projectSlug: external_exports.string().min(1).nullable(),
  projectWorkspaceKey: external_exports.string().min(1).nullable(),
  assigneeAgentSlug: external_exports.string().min(1).nullable(),
  description: external_exports.string().nullable(),
  recurring: external_exports.boolean().default(false),
  routine: portabilityIssueRoutineManifestEntrySchema.nullable(),
  legacyRecurrence: external_exports.record(external_exports.string(), external_exports.unknown()).nullable(),
  status: external_exports.string().nullable(),
  priority: external_exports.string().nullable(),
  labelIds: external_exports.array(external_exports.string().min(1)).default([]),
  billingCode: external_exports.string().nullable(),
  executionWorkspaceSettings: external_exports.record(external_exports.string(), external_exports.unknown()).nullable(),
  assigneeAdapterOverrides: external_exports.record(external_exports.string(), external_exports.unknown()).nullable(),
  comments: external_exports.array(portabilityIssueCommentManifestEntrySchema).default([]),
  metadata: external_exports.record(external_exports.string(), external_exports.unknown()).nullable()
});
var portabilityManifestSchema = external_exports.object({
  schemaVersion: external_exports.number().int().positive(),
  generatedAt: external_exports.string().datetime(),
  source: external_exports.object({
    companyId: external_exports.string().uuid(),
    companyName: external_exports.string().min(1)
  }).nullable(),
  includes: external_exports.object({
    company: external_exports.boolean(),
    agents: external_exports.boolean(),
    projects: external_exports.boolean(),
    issues: external_exports.boolean(),
    skills: external_exports.boolean()
  }),
  company: portabilityCompanyManifestEntrySchema.nullable(),
  sidebar: portabilitySidebarOrderSchema.nullable(),
  agents: external_exports.array(portabilityAgentManifestEntrySchema),
  skills: external_exports.array(portabilitySkillManifestEntrySchema).default([]),
  projects: external_exports.array(portabilityProjectManifestEntrySchema).default([]),
  issues: external_exports.array(portabilityIssueManifestEntrySchema).default([]),
  envInputs: external_exports.array(portabilityEnvInputSchema).default([])
});
var portabilitySourceSchema = external_exports.discriminatedUnion("type", [
  external_exports.object({
    type: external_exports.literal("inline"),
    rootPath: external_exports.string().min(1).optional().nullable(),
    files: external_exports.record(external_exports.string(), portabilityFileEntrySchema)
  }),
  external_exports.object({
    type: external_exports.literal("github"),
    url: external_exports.string().url()
  })
]);
var portabilityTargetSchema = external_exports.discriminatedUnion("mode", [
  external_exports.object({
    mode: external_exports.literal("new_company"),
    newCompanyName: external_exports.string().min(1).optional().nullable()
  }),
  external_exports.object({
    mode: external_exports.literal("existing_company"),
    companyId: external_exports.string().uuid()
  })
]);
var portabilityAgentSelectionSchema = external_exports.union([
  external_exports.literal("all"),
  external_exports.array(external_exports.string().min(1))
]);
var portabilityCollisionStrategySchema = external_exports.enum(["rename", "skip", "replace"]);
var companyPortabilityExportSchema = external_exports.object({
  include: portabilityIncludeSchema.optional(),
  agents: external_exports.array(external_exports.string().min(1)).optional(),
  skills: external_exports.array(external_exports.string().min(1)).optional(),
  projects: external_exports.array(external_exports.string().min(1)).optional(),
  issues: external_exports.array(external_exports.string().min(1)).optional(),
  projectIssues: external_exports.array(external_exports.string().min(1)).optional(),
  selectedFiles: external_exports.array(external_exports.string().min(1)).optional(),
  expandReferencedSkills: external_exports.boolean().optional(),
  sidebarOrder: portabilitySidebarOrderSchema.partial().optional()
});
var companyPortabilityPreviewSchema = external_exports.object({
  source: portabilitySourceSchema,
  include: portabilityIncludeSchema.optional(),
  target: portabilityTargetSchema,
  agents: portabilityAgentSelectionSchema.optional(),
  collisionStrategy: portabilityCollisionStrategySchema.optional(),
  nameOverrides: external_exports.record(external_exports.string().min(1), external_exports.string().min(1)).optional(),
  selectedFiles: external_exports.array(external_exports.string().min(1)).optional()
});
var portabilityAdapterOverrideSchema = external_exports.object({
  adapterType: external_exports.string().min(1),
  adapterConfig: external_exports.record(external_exports.string(), external_exports.unknown()).optional()
});
var companyPortabilityImportSchema = companyPortabilityPreviewSchema.extend({
  adapterOverrides: external_exports.record(external_exports.string().min(1), portabilityAdapterOverrideSchema).optional(),
  secretValues: external_exports.record(external_exports.string().min(1), external_exports.string()).optional()
});

// ../../node_modules/.pnpm/@paperclipai+shared@2026.722.0/node_modules/@paperclipai/shared/dist/validators/teams-catalog.js
var catalogTeamKindSchema = external_exports.enum(["bundled", "optional"]);
var catalogTeamTrustLevelSchema = external_exports.enum([
  "markdown_only",
  "assets",
  "scripts_executables",
  "external_sources"
]);
var catalogTeamCompatibilitySchema = external_exports.enum(["compatible", "unknown", "invalid"]);
var catalogTeamFileKindSchema = external_exports.enum([
  "team",
  "agent",
  "project",
  "task",
  "skill",
  "extension",
  "readme",
  "reference",
  "script",
  "asset",
  "markdown",
  "other"
]);
var catalogTeamSkillRequirementTypeSchema = external_exports.enum([
  "catalog",
  "local",
  "skills_sh",
  "github",
  "url",
  "local_path",
  "agent_package"
]);
var catalogTeamSkillRequirementSchema = external_exports.object({
  type: catalogTeamSkillRequirementTypeSchema,
  ref: external_exports.string().min(1),
  agentSlugs: external_exports.array(external_exports.string().min(1)),
  resolved: external_exports.boolean(),
  catalogSkillId: external_exports.string().min(1).optional(),
  catalogSkillKey: external_exports.string().min(1).optional(),
  localPath: external_exports.string().min(1).optional(),
  sourceLocator: external_exports.string().min(1).optional(),
  sourceRef: external_exports.string().min(1).optional()
});
var catalogTeamEnvInputSummarySchema = external_exports.object({
  key: external_exports.string().min(1),
  agentSlug: external_exports.string().min(1).nullable(),
  projectSlug: external_exports.string().min(1).nullable(),
  kind: external_exports.enum(["secret", "plain"]),
  requirement: external_exports.enum(["required", "optional"])
});
var catalogTeamSourceRefSchema = external_exports.object({
  type: external_exports.enum(["skills_sh", "github", "url", "local_path", "agent_package", "include"]),
  ref: external_exports.string().min(1),
  pinned: external_exports.boolean()
});
var catalogTeamFileSchema = external_exports.object({
  path: external_exports.string().min(1),
  kind: catalogTeamFileKindSchema,
  sizeBytes: external_exports.number().int().nonnegative(),
  sha256: external_exports.string().min(1)
});
var catalogTeamSchema = external_exports.object({
  id: external_exports.string().min(1),
  key: external_exports.string().min(1),
  kind: catalogTeamKindSchema,
  category: external_exports.string().min(1),
  slug: external_exports.string().min(1),
  name: external_exports.string().min(1),
  description: external_exports.string(),
  path: external_exports.string().min(1),
  entrypoint: external_exports.literal("TEAM.md"),
  schema: external_exports.literal("agentcompanies/v1"),
  defaultInstall: external_exports.boolean(),
  recommendedForCompanyTypes: external_exports.array(external_exports.string()),
  tags: external_exports.array(external_exports.string()),
  counts: external_exports.object({
    agents: external_exports.number().int().nonnegative(),
    projects: external_exports.number().int().nonnegative(),
    tasks: external_exports.number().int().nonnegative(),
    routines: external_exports.number().int().nonnegative(),
    localSkills: external_exports.number().int().nonnegative(),
    catalogSkills: external_exports.number().int().nonnegative(),
    externalSkillSources: external_exports.number().int().nonnegative()
  }),
  rootAgentSlugs: external_exports.array(external_exports.string()),
  agentSlugs: external_exports.array(external_exports.string()),
  projectSlugs: external_exports.array(external_exports.string()),
  requiredSkills: external_exports.array(catalogTeamSkillRequirementSchema),
  envInputs: external_exports.array(catalogTeamEnvInputSummarySchema),
  sourceRefs: external_exports.array(catalogTeamSourceRefSchema),
  files: external_exports.array(catalogTeamFileSchema),
  trustLevel: catalogTeamTrustLevelSchema,
  compatibility: catalogTeamCompatibilitySchema,
  contentHash: external_exports.string().min(1),
  packageName: external_exports.string().min(1).optional(),
  packageVersion: external_exports.string().min(1).optional()
});
var catalogTeamListQuerySchema = external_exports.object({
  kind: catalogTeamKindSchema.optional(),
  category: external_exports.string().min(1).optional(),
  q: external_exports.string().min(1).optional()
});
var catalogTeamFileDetailSchema = external_exports.object({
  catalogTeamId: external_exports.string().min(1),
  path: external_exports.string().min(1),
  kind: catalogTeamFileKindSchema,
  content: external_exports.string(),
  language: external_exports.string().nullable(),
  markdown: external_exports.boolean()
});
var catalogTeamSourcePolicySchema = external_exports.object({
  allowExternalSources: external_exports.boolean().optional(),
  allowUnpinnedOptionalSources: external_exports.boolean().optional(),
  allowLocalPathSources: external_exports.boolean().optional()
}).strict();
var catalogTeamPreviewSchema = external_exports.object({
  targetManagerAgentId: external_exports.string().min(1).nullable().optional(),
  targetManagerSlug: external_exports.string().min(1).nullable().optional(),
  include: portabilityIncludeSchema.omit({ company: true }).strict().optional(),
  agents: portabilityAgentSelectionSchema.optional(),
  collisionStrategy: portabilityCollisionStrategySchema.optional(),
  nameOverrides: external_exports.record(external_exports.string().min(1), external_exports.string().min(1)).optional(),
  selectedFiles: external_exports.array(external_exports.string().min(1)).optional(),
  sourcePolicy: catalogTeamSourcePolicySchema.optional()
}).strict();
var catalogTeamInstallSchema = catalogTeamPreviewSchema.extend({
  adapterOverrides: external_exports.record(external_exports.string().min(1), portabilityAdapterOverrideSchema).optional(),
  secretValues: external_exports.record(external_exports.string().min(1), external_exports.string()).optional()
}).strict();
var catalogTeamSkillPreparationSchema = external_exports.object({
  type: catalogTeamSkillRequirementTypeSchema,
  ref: external_exports.string().min(1),
  agentSlugs: external_exports.array(external_exports.string().min(1)),
  action: external_exports.enum([
    "already_in_package",
    "catalog_install_required",
    "external_import_required",
    "blocked"
  ]),
  catalogSkillId: external_exports.string().min(1).nullable(),
  catalogSkillKey: external_exports.string().min(1).nullable(),
  sourceLocator: external_exports.string().min(1).nullable(),
  sourceRef: external_exports.string().min(1).nullable(),
  reason: external_exports.string().min(1).nullable()
});

// ../../node_modules/.pnpm/@paperclipai+shared@2026.722.0/node_modules/@paperclipai/shared/dist/validators/adapter-skills.js
var agentSkillStateSchema = external_exports.enum([
  "available",
  "configured",
  "installed",
  "missing",
  "stale",
  "external"
]);
var agentSkillOriginSchema = external_exports.enum([
  "company_managed",
  "user_installed",
  "external_unknown"
]);
var agentSkillSyncModeSchema = external_exports.enum([
  "unsupported",
  "persistent",
  "ephemeral"
]);
var agentDesiredSkillEntrySchema = external_exports.object({
  key: external_exports.string().min(1),
  versionId: external_exports.string().uuid().nullable()
});
var agentDesiredSkillSelectionSchema = external_exports.union([
  external_exports.string().min(1),
  agentDesiredSkillEntrySchema
]);
var agentSkillEntrySchema = external_exports.object({
  key: external_exports.string().min(1),
  runtimeName: external_exports.string().min(1).nullable(),
  versionId: external_exports.string().uuid().nullable().optional(),
  currentVersionId: external_exports.string().uuid().nullable().optional(),
  desired: external_exports.boolean(),
  managed: external_exports.boolean(),
  state: agentSkillStateSchema,
  origin: agentSkillOriginSchema.optional(),
  originLabel: external_exports.string().nullable().optional(),
  locationLabel: external_exports.string().nullable().optional(),
  readOnly: external_exports.boolean().optional(),
  sourcePath: external_exports.string().nullable().optional(),
  targetPath: external_exports.string().nullable().optional(),
  detail: external_exports.string().nullable().optional()
});
var agentSkillSnapshotSchema = external_exports.object({
  adapterType: external_exports.string().min(1),
  supported: external_exports.boolean(),
  mode: agentSkillSyncModeSchema,
  desiredSkills: external_exports.array(external_exports.string().min(1)),
  desiredSkillEntries: external_exports.array(agentDesiredSkillEntrySchema).optional(),
  entries: external_exports.array(agentSkillEntrySchema),
  warnings: external_exports.array(external_exports.string())
});
var agentSkillSyncSchema = external_exports.object({
  desiredSkills: external_exports.array(agentDesiredSkillSelectionSchema)
});

// ../../node_modules/.pnpm/@paperclipai+shared@2026.722.0/node_modules/@paperclipai/shared/dist/validators/agent.js
var agentPermissionsSchema = external_exports.object({
  canCreateAgents: external_exports.boolean().optional().default(false),
  canCreateSkills: external_exports.boolean().optional().default(true),
  trustPreset: trustPresetSchema.optional(),
  authorizationPolicy: trustAuthorizationPolicySchema.optional()
}).catchall(external_exports.unknown());
var agentInstructionsBundleModeSchema = external_exports.enum(["managed", "external"]);
var updateAgentInstructionsBundleSchema = external_exports.object({
  mode: agentInstructionsBundleModeSchema.optional(),
  rootPath: external_exports.string().trim().min(1).nullable().optional(),
  entryFile: external_exports.string().trim().min(1).optional(),
  clearLegacyPromptTemplate: external_exports.boolean().optional().default(false)
});
var upsertAgentInstructionsFileSchema = external_exports.object({
  path: external_exports.string().trim().min(1),
  content: external_exports.string(),
  clearLegacyPromptTemplate: external_exports.boolean().optional().default(false)
});
var adapterConfigSchema = external_exports.record(external_exports.string(), external_exports.unknown()).superRefine((value, ctx) => {
  const envValue = value.env;
  if (envValue === void 0)
    return;
  const parsed = envConfigSchema.safeParse(envValue);
  if (!parsed.success) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      message: "adapterConfig.env must be a map of valid env bindings",
      path: ["env"]
    });
  }
});
var createAgentInstructionsBundleSchema = external_exports.object({
  entryFile: external_exports.string().trim().min(1).optional(),
  files: external_exports.record(external_exports.string(), external_exports.string()).refine((files) => Object.keys(files).length > 0, {
    message: "instructionsBundle.files must contain at least one file"
  })
});
var agentModelProfileConfigSchema = external_exports.object({
  enabled: external_exports.boolean().optional(),
  label: external_exports.string().trim().min(1).optional(),
  adapterConfig: adapterConfigSchema
}).strict();
var agentRuntimeConfigSchema = external_exports.object({
  modelProfiles: external_exports.object({
    cheap: agentModelProfileConfigSchema.optional()
  }).strict().optional()
}).catchall(external_exports.unknown());
var createAgentSchema = external_exports.object({
  name: external_exports.string().min(1),
  role: external_exports.enum(AGENT_ROLES).optional().default("general"),
  title: external_exports.string().optional().nullable(),
  icon: external_exports.enum(AGENT_ICON_NAMES).optional().nullable(),
  reportsTo: external_exports.string().uuid().optional().nullable(),
  capabilities: external_exports.string().optional().nullable(),
  desiredSkills: external_exports.array(agentDesiredSkillSelectionSchema).optional(),
  adapterType: agentAdapterTypeSchema,
  adapterConfig: adapterConfigSchema.optional().default({}),
  instructionsBundle: createAgentInstructionsBundleSchema.optional(),
  runtimeConfig: agentRuntimeConfigSchema.optional().default({}),
  defaultEnvironmentId: external_exports.string().uuid().optional().nullable(),
  budgetMonthlyCents: external_exports.number().int().nonnegative().optional().default(0),
  permissions: agentPermissionsSchema.optional(),
  metadata: external_exports.record(external_exports.string(), external_exports.unknown()).optional().nullable()
});
var builtInAgentProvisionSchema = external_exports.object({
  adapterType: agentAdapterTypeSchema.optional(),
  adapterConfig: adapterConfigSchema.optional(),
  budgetMonthlyCents: external_exports.number().int().nonnegative().optional()
}).strict();
var builtInAgentEmptyMutationSchema = external_exports.object({}).strict().default({});
var builtInAgentResetSchema = external_exports.object({
  resources: external_exports.array(external_exports.enum(["agent", "instructions", "skill", "routine"])).optional()
}).strict().default({});
var createAgentHireSchema = createAgentSchema.extend({
  sourceIssueId: external_exports.string().uuid().optional().nullable(),
  sourceIssueIds: external_exports.array(external_exports.string().uuid()).optional()
});
var updateAgentSchema = createAgentSchema.omit({ permissions: true }).partial().extend({
  permissions: external_exports.never().optional(),
  replaceAdapterConfig: external_exports.boolean().optional(),
  status: external_exports.enum(AGENT_STATUSES).optional(),
  spentMonthlyCents: external_exports.number().int().nonnegative().optional()
});
var updateAgentInstructionsPathSchema = external_exports.object({
  path: external_exports.string().trim().min(1).nullable(),
  adapterConfigKey: external_exports.string().trim().min(1).optional()
});
var taskBridgeAgentKeyScopeSchema = external_exports.object({
  kind: external_exports.literal("task_bridge"),
  projectId: external_exports.string().uuid().optional().nullable(),
  projectIds: external_exports.array(external_exports.string().uuid()).max(50).optional(),
  parentIssueId: external_exports.string().uuid().optional().nullable(),
  parentIssueIds: external_exports.array(external_exports.string().uuid()).max(50).optional(),
  allowedAssigneeAgentIds: external_exports.array(external_exports.string().uuid()).max(50).optional()
}).strict().superRefine((value, ctx) => {
  const hasProjectBoundary = Boolean(value.projectId) || Boolean(value.projectIds?.length);
  const hasParentBoundary = Boolean(value.parentIssueId) || Boolean(value.parentIssueIds?.length);
  if (!hasProjectBoundary && !hasParentBoundary) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      message: "task_bridge keys require at least one project or parent issue boundary",
      path: ["projectId"]
    });
  }
});
var standardAgentKeyScopeSchema = external_exports.object({
  kind: external_exports.literal("standard")
}).strict();
var skillTestAgentKeyScopeSchema = external_exports.object({
  kind: external_exports.literal("skill_test"),
  issueId: external_exports.string().uuid()
}).strict();
var agentApiKeyScopeSchema = external_exports.union([
  standardAgentKeyScopeSchema,
  taskBridgeAgentKeyScopeSchema,
  skillTestAgentKeyScopeSchema
]);
var createAgentKeySchema = external_exports.object({
  name: external_exports.string().min(1).default("default"),
  scope: agentApiKeyScopeSchema.optional().default({ kind: "standard" })
});
var agentMineInboxQuerySchema = external_exports.object({
  userId: external_exports.string().trim().min(1),
  status: external_exports.string().trim().min(1).optional().default(INBOX_MINE_ISSUE_STATUS_FILTER)
});
var wakeAgentSchema = external_exports.object({
  source: external_exports.enum(["timer", "assignment", "on_demand", "automation"]).optional().default("on_demand"),
  triggerDetail: external_exports.enum(["manual", "ping", "callback", "system"]).optional(),
  reason: external_exports.string().optional().nullable(),
  payload: external_exports.record(external_exports.string(), external_exports.unknown()).optional().nullable(),
  idempotencyKey: external_exports.string().optional().nullable(),
  forceFreshSession: external_exports.preprocess((value) => value === null ? void 0 : value, external_exports.boolean().optional().default(false))
});
var resetAgentSessionSchema = external_exports.object({
  taskKey: external_exports.string().min(1).optional().nullable()
});
var testAdapterEnvironmentSchema = external_exports.object({
  adapterConfig: adapterConfigSchema.optional().default({}),
  /**
   * Optional environment to run the adapter test inside. When omitted, the
   * test runs against the local Paperclip host. When provided and the
   * environment is non-local (SSH/sandbox), the test probes are executed
   * inside that environment so the result reflects real agent execution.
   */
  environmentId: external_exports.string().uuid().optional().nullable()
});
var updateAgentPermissionsSchema = external_exports.object({
  canCreateAgents: external_exports.boolean(),
  canCreateSkills: external_exports.boolean().optional(),
  canAssignTasks: external_exports.boolean(),
  trustPreset: trustPresetSchema.optional(),
  authorizationPolicy: trustAuthorizationPolicySchema.optional()
});

// ../../node_modules/.pnpm/@paperclipai+shared@2026.722.0/node_modules/@paperclipai/shared/dist/validators/project.js
var executionWorkspaceStrategySchema2 = external_exports.object({
  type: external_exports.enum(["project_primary", "git_worktree", "adapter_managed", "cloud_sandbox"]).optional(),
  baseRef: external_exports.string().optional().nullable(),
  branchTemplate: external_exports.string().optional().nullable(),
  worktreeParentDir: external_exports.string().optional().nullable(),
  provisionCommand: external_exports.string().optional().nullable(),
  teardownCommand: external_exports.string().optional().nullable()
}).strict();
var projectExecutionWorkspacePolicySchema = external_exports.object({
  enabled: external_exports.boolean(),
  defaultMode: external_exports.enum(["shared_workspace", "isolated_workspace", "operator_branch", "adapter_default"]).optional(),
  allowIssueOverride: external_exports.boolean().optional(),
  defaultProjectWorkspaceId: external_exports.string().uuid().optional().nullable(),
  environmentId: external_exports.string().uuid().optional().nullable(),
  workspaceStrategy: executionWorkspaceStrategySchema2.optional().nullable(),
  workspaceRuntime: external_exports.record(external_exports.string(), external_exports.unknown()).optional().nullable(),
  branchPolicy: external_exports.record(external_exports.string(), external_exports.unknown()).optional().nullable(),
  pullRequestPolicy: external_exports.record(external_exports.string(), external_exports.unknown()).optional().nullable(),
  runtimePolicy: external_exports.record(external_exports.string(), external_exports.unknown()).optional().nullable(),
  cleanupPolicy: external_exports.record(external_exports.string(), external_exports.unknown()).optional().nullable(),
  authorizationPolicy: trustAuthorizationPolicySchema.optional().nullable()
}).strict();
var projectWorkspaceRuntimeConfigSchema = external_exports.object({
  workspaceRuntime: external_exports.record(external_exports.string(), external_exports.unknown()).optional().nullable(),
  desiredState: external_exports.enum(["running", "stopped", "manual"]).optional().nullable(),
  serviceStates: external_exports.record(external_exports.enum(["running", "stopped", "manual"])).optional().nullable()
}).strict();
var projectWorkspaceSourceTypeSchema = external_exports.enum(["local_path", "git_repo", "remote_managed", "non_git_path"]);
var projectWorkspaceVisibilitySchema = external_exports.enum(["default", "advanced"]);
var projectWorkspaceFields = {
  name: external_exports.string().min(1).optional(),
  sourceType: projectWorkspaceSourceTypeSchema.optional(),
  cwd: external_exports.string().min(1).optional().nullable(),
  repoUrl: external_exports.string().url().optional().nullable(),
  repoRef: external_exports.string().optional().nullable(),
  defaultRef: external_exports.string().optional().nullable(),
  visibility: projectWorkspaceVisibilitySchema.optional(),
  setupCommand: external_exports.string().optional().nullable(),
  cleanupCommand: external_exports.string().optional().nullable(),
  remoteProvider: external_exports.string().optional().nullable(),
  remoteWorkspaceRef: external_exports.string().optional().nullable(),
  sharedWorkspaceKey: external_exports.string().optional().nullable(),
  metadata: external_exports.record(external_exports.string(), external_exports.unknown()).optional().nullable(),
  runtimeConfig: projectWorkspaceRuntimeConfigSchema.optional().nullable()
};
function validateProjectWorkspace(value, ctx) {
  const sourceType = value.sourceType ?? "local_path";
  const hasCwd = typeof value.cwd === "string" && value.cwd.trim().length > 0;
  const hasRepo = typeof value.repoUrl === "string" && value.repoUrl.trim().length > 0;
  const hasRemoteRef = typeof value.remoteWorkspaceRef === "string" && value.remoteWorkspaceRef.trim().length > 0;
  if (sourceType === "remote_managed") {
    if (!hasRemoteRef && !hasRepo) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        message: "Remote-managed workspace requires remoteWorkspaceRef or repoUrl.",
        path: ["remoteWorkspaceRef"]
      });
    }
    return;
  }
  if (!hasCwd && !hasRepo) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      message: "Workspace requires at least one of cwd or repoUrl.",
      path: ["cwd"]
    });
  }
}
var createProjectWorkspaceSchema = external_exports.object({
  ...projectWorkspaceFields,
  isPrimary: external_exports.boolean().optional().default(false)
}).superRefine(validateProjectWorkspace);
var updateProjectWorkspaceSchema = external_exports.object({
  ...projectWorkspaceFields,
  isPrimary: external_exports.boolean().optional()
}).partial();
var projectFields = {
  /** @deprecated Use goalIds instead */
  goalId: external_exports.string().uuid().optional().nullable(),
  goalIds: external_exports.array(external_exports.string().uuid()).optional(),
  name: external_exports.string().min(1),
  description: external_exports.string().optional().nullable(),
  status: external_exports.enum(PROJECT_STATUSES).optional().default("backlog"),
  leadAgentId: external_exports.string().uuid().optional().nullable(),
  targetDate: external_exports.string().optional().nullable(),
  color: external_exports.string().optional().nullable(),
  icon: external_exports.enum(PROJECT_ICON_NAMES).optional().nullable(),
  env: envConfigSchema.optional().nullable(),
  executionWorkspacePolicy: projectExecutionWorkspacePolicySchema.optional().nullable(),
  archivedAt: external_exports.string().datetime().optional().nullable()
};
var createProjectSchema = external_exports.object({
  ...projectFields,
  workspace: createProjectWorkspaceSchema.optional()
});
var updateProjectSchema = external_exports.object(projectFields).partial();

// ../../node_modules/.pnpm/@paperclipai+shared@2026.722.0/node_modules/@paperclipai/shared/dist/validators/document-annotation.js
var documentAnnotationThreadStatusSchema = external_exports.enum(DOCUMENT_ANNOTATION_THREAD_STATUSES);
var documentAnnotationAnchorStateSchema = external_exports.enum(DOCUMENT_ANNOTATION_ANCHOR_STATES);
var documentAnnotationAnchorConfidenceSchema = external_exports.enum(DOCUMENT_ANNOTATION_ANCHOR_CONFIDENCES);
var documentAnnotationTextQuoteSelectorSchema = external_exports.object({
  exact: external_exports.string().min(1).max(1e4),
  prefix: external_exports.string().max(1e3).default(""),
  suffix: external_exports.string().max(1e3).default("")
}).strict();
var documentAnnotationTextPositionSelectorSchema = external_exports.object({
  normalizedStart: external_exports.number().int().nonnegative(),
  normalizedEnd: external_exports.number().int().nonnegative(),
  markdownStart: external_exports.number().int().nonnegative(),
  markdownEnd: external_exports.number().int().nonnegative()
}).strict().superRefine((value, ctx) => {
  if (value.normalizedEnd <= value.normalizedStart) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      message: "normalizedEnd must be greater than normalizedStart",
      path: ["normalizedEnd"]
    });
  }
  if (value.markdownEnd <= value.markdownStart) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      message: "markdownEnd must be greater than markdownStart",
      path: ["markdownEnd"]
    });
  }
});
var documentAnnotationAnchorSelectorSchema = external_exports.object({
  quote: documentAnnotationTextQuoteSelectorSchema,
  position: documentAnnotationTextPositionSelectorSchema
}).strict();
var createDocumentAnnotationThreadSchema = external_exports.object({
  baseRevisionId: external_exports.string().uuid(),
  baseRevisionNumber: external_exports.number().int().positive(),
  selector: documentAnnotationAnchorSelectorSchema,
  body: multilineTextSchema.pipe(external_exports.string().min(1).max(2e4)),
  issueCommentId: external_exports.string().uuid().nullable().optional()
}).strict();
var createDocumentAnnotationCommentSchema = external_exports.object({
  body: multilineTextSchema.pipe(external_exports.string().min(1).max(2e4)),
  issueCommentId: external_exports.string().uuid().nullable().optional()
}).strict();
var updateDocumentAnnotationThreadSchema = external_exports.object({
  status: documentAnnotationThreadStatusSchema.optional()
}).strict().refine((value) => value.status != null, {
  message: "At least one field must be provided"
});

// ../../node_modules/.pnpm/@paperclipai+shared@2026.722.0/node_modules/@paperclipai/shared/dist/agent-url-key.js
var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isUuidLike(value) {
  if (typeof value !== "string")
    return false;
  return UUID_RE.test(value.trim());
}

// ../../node_modules/.pnpm/@paperclipai+shared@2026.722.0/node_modules/@paperclipai/shared/dist/validators/search.js
var COMPANY_SEARCH_MAX_QUERY_LENGTH = 200;
var COMPANY_SEARCH_DEFAULT_LIMIT = 20;
var COMPANY_SEARCH_MAX_LIMIT = 50;
var COMPANY_SEARCH_MAX_OFFSET = 200;
var COMPANY_SEARCH_EXTRACT_DEFAULT_LIMIT = 100;
var COMPANY_SEARCH_EXTRACT_MAX_LIMIT = 200;
var COMPANY_SEARCH_EXTRACT_MAX_OFFSET = 5e3;
var COMPANY_SEARCH_EXTRACT_DEFAULT_MATCHES_PER_ISSUE = 20;
var COMPANY_SEARCH_EXTRACT_MAX_MATCHES_PER_ISSUE = 200;
var UPDATED_WITHIN_RE = /^[1-9]\d{0,2}(h|d|w|m)$/;
function firstQueryValue(value) {
  return Array.isArray(value) ? value[0] : value;
}
function queryValues(value) {
  if (value === void 0 || value === null)
    return [];
  return Array.isArray(value) ? value : [value];
}
function parseOptionalString(value, ctx, field2) {
  const raw = firstQueryValue(value);
  if (raw === void 0 || raw === null)
    return void 0;
  if (typeof raw !== "string" && typeof raw !== "number") {
    ctx.addIssue({ code: external_exports.ZodIssueCode.custom, message: `${field2} must be a string` });
    return void 0;
  }
  const normalized = String(raw).trim();
  return normalized.length > 0 ? normalized : void 0;
}
function parseIntegerQuery(value, ctx, field2, fallback, min, max) {
  const raw = firstQueryValue(value);
  if (raw === void 0 || raw === null || raw === "")
    return fallback;
  const text = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.trim() : "";
  if (!/^-?\d+$/.test(text)) {
    ctx.addIssue({ code: external_exports.ZodIssueCode.custom, message: `${field2} must be an integer` });
    return fallback;
  }
  const numeric = Number.parseInt(text, 10);
  if (!Number.isInteger(numeric) || numeric < min || numeric > max) {
    const range = min === 0 ? `between 0 and ${max}` : `between ${min} and ${max}`;
    ctx.addIssue({ code: external_exports.ZodIssueCode.custom, message: `${field2} must be ${range}` });
    return fallback;
  }
  return numeric;
}
function parseEnumList(value, ctx, field2, allowed) {
  const allowedSet = new Set(allowed);
  const values = [];
  for (const rawEntry of queryValues(value)) {
    if (typeof rawEntry !== "string") {
      ctx.addIssue({ code: external_exports.ZodIssueCode.custom, message: `${field2} must be a comma-separated string` });
      continue;
    }
    for (const rawItem of rawEntry.split(",")) {
      const item = rawItem.trim();
      if (!item)
        continue;
      if (!allowedSet.has(item)) {
        ctx.addIssue({ code: external_exports.ZodIssueCode.custom, message: `${field2} contains an unsupported value` });
        continue;
      }
      if (!values.includes(item))
        values.push(item);
    }
  }
  return values;
}
function parseOptionalUuid(value, ctx, field2) {
  const normalized = parseOptionalString(value, ctx, field2);
  if (normalized === void 0)
    return void 0;
  if (!isUuidLike(normalized)) {
    ctx.addIssue({ code: external_exports.ZodIssueCode.custom, message: `${field2} must be a UUID` });
    return void 0;
  }
  return normalized;
}
function parseAssigneeAgentId(value, ctx) {
  const normalized = parseOptionalString(value, ctx, "assigneeAgentId");
  if (normalized === void 0)
    return void 0;
  if (normalized.toLowerCase() === "null")
    return null;
  if (!isUuidLike(normalized)) {
    ctx.addIssue({ code: external_exports.ZodIssueCode.custom, message: "assigneeAgentId must be a UUID or 'null'" });
    return void 0;
  }
  return normalized;
}
function parseUpdatedAfter(value, ctx) {
  const normalized = parseOptionalString(value, ctx, "updatedAfter");
  if (normalized === void 0)
    return void 0;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    ctx.addIssue({ code: external_exports.ZodIssueCode.custom, message: "updatedAfter must be a valid date" });
    return void 0;
  }
  return date.toISOString();
}
function parseUpdatedWithin(value, ctx) {
  const normalized = parseOptionalString(value, ctx, "updatedWithin");
  if (normalized === void 0)
    return void 0;
  if (!UPDATED_WITHIN_RE.test(normalized)) {
    ctx.addIssue({ code: external_exports.ZodIssueCode.custom, message: "updatedWithin must be a duration like 24h, 7d, 4w, or 3m" });
    return void 0;
  }
  return normalized;
}
var companySearchQuerySchema = external_exports.object({
  q: external_exports.unknown().optional().transform((value, ctx) => (parseOptionalString(value, ctx, "q") ?? "").slice(0, COMPANY_SEARCH_MAX_QUERY_LENGTH)),
  scope: external_exports.unknown().optional().transform((value, ctx) => {
    const normalized = parseOptionalString(value, ctx, "scope") ?? "all";
    if (!COMPANY_SEARCH_SCOPES.includes(normalized)) {
      ctx.addIssue({ code: external_exports.ZodIssueCode.custom, message: "scope must be a supported search scope" });
      return "all";
    }
    return normalized;
  }),
  limit: external_exports.unknown().optional().transform((value, ctx) => parseIntegerQuery(value, ctx, "limit", COMPANY_SEARCH_DEFAULT_LIMIT, 1, COMPANY_SEARCH_MAX_LIMIT)),
  offset: external_exports.unknown().optional().transform((value, ctx) => parseIntegerQuery(value, ctx, "offset", 0, 0, COMPANY_SEARCH_MAX_OFFSET)),
  status: external_exports.unknown().optional().transform((value, ctx) => parseEnumList(value, ctx, "status", ISSUE_STATUSES)),
  priority: external_exports.unknown().optional().transform((value, ctx) => parseEnumList(value, ctx, "priority", ISSUE_PRIORITIES)),
  assigneeAgentId: external_exports.unknown().optional().transform((value, ctx) => parseAssigneeAgentId(value, ctx)),
  assigneeUserId: external_exports.unknown().optional().transform((value, ctx) => parseOptionalString(value, ctx, "assigneeUserId")),
  projectId: external_exports.unknown().optional().transform((value, ctx) => parseOptionalUuid(value, ctx, "projectId")),
  labelId: external_exports.unknown().optional().transform((value, ctx) => parseOptionalUuid(value, ctx, "labelId")),
  updatedWithin: external_exports.unknown().optional().transform((value, ctx) => parseUpdatedWithin(value, ctx)),
  updatedAfter: external_exports.unknown().optional().transform((value, ctx) => parseUpdatedAfter(value, ctx)),
  sort: external_exports.unknown().optional().transform((value, ctx) => {
    const normalized = parseOptionalString(value, ctx, "sort") ?? "relevance";
    if (!COMPANY_SEARCH_SORTS.includes(normalized)) {
      ctx.addIssue({ code: external_exports.ZodIssueCode.custom, message: "sort must be relevance, updated, created, or priority" });
      return "relevance";
    }
    return normalized;
  })
});
var companySearchExtractQuerySchema = external_exports.object({
  contains: external_exports.unknown().transform((value, ctx) => {
    const normalized = parseOptionalString(value, ctx, "contains");
    if (!normalized || normalized.length < 2) {
      ctx.addIssue({ code: external_exports.ZodIssueCode.custom, message: "contains must be at least 2 characters" });
      return "";
    }
    if (normalized.length > COMPANY_SEARCH_MAX_QUERY_LENGTH) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        message: `contains must be at most ${COMPANY_SEARCH_MAX_QUERY_LENGTH} characters`
      });
    }
    return normalized.slice(0, COMPANY_SEARCH_MAX_QUERY_LENGTH);
  }),
  kind: external_exports.unknown().optional().transform((value, ctx) => {
    const normalized = parseOptionalString(value, ctx, "kind") ?? "literal";
    if (!COMPANY_SEARCH_EXTRACT_KINDS.includes(normalized)) {
      ctx.addIssue({ code: external_exports.ZodIssueCode.custom, message: "kind must be literal or url" });
      return "literal";
    }
    return normalized;
  }),
  scope: external_exports.unknown().optional().transform((value, ctx) => {
    const normalized = parseOptionalString(value, ctx, "scope") ?? "all";
    if (!COMPANY_SEARCH_EXTRACT_SCOPES.includes(normalized)) {
      ctx.addIssue({ code: external_exports.ZodIssueCode.custom, message: "scope must be all, issues, comments, or documents" });
      return "all";
    }
    return normalized;
  }),
  limit: external_exports.unknown().optional().transform((value, ctx) => parseIntegerQuery(value, ctx, "limit", COMPANY_SEARCH_EXTRACT_DEFAULT_LIMIT, 1, COMPANY_SEARCH_EXTRACT_MAX_LIMIT)),
  offset: external_exports.unknown().optional().transform((value, ctx) => parseIntegerQuery(value, ctx, "offset", 0, 0, COMPANY_SEARCH_EXTRACT_MAX_OFFSET)),
  matchesPerIssue: external_exports.unknown().optional().transform((value, ctx) => parseIntegerQuery(value, ctx, "matchesPerIssue", COMPANY_SEARCH_EXTRACT_DEFAULT_MATCHES_PER_ISSUE, 1, COMPANY_SEARCH_EXTRACT_MAX_MATCHES_PER_ISSUE)),
  status: external_exports.unknown().optional().transform((value, ctx) => parseEnumList(value, ctx, "status", ISSUE_STATUSES)),
  updatedWithin: external_exports.unknown().optional().transform((value, ctx) => parseUpdatedWithin(value, ctx)),
  updatedAfter: external_exports.unknown().optional().transform((value, ctx) => parseUpdatedAfter(value, ctx))
}).superRefine((value, ctx) => {
  if (value.updatedWithin && value.updatedAfter) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      message: "updatedWithin and updatedAfter cannot be used together"
    });
  }
});

// ../../node_modules/.pnpm/@paperclipai+shared@2026.722.0/node_modules/@paperclipai/shared/dist/validators/issue-tree-control.js
var issueTreeControlModeSchema = external_exports.enum(ISSUE_TREE_CONTROL_MODES);
var issueTreeHoldReleasePolicySchema = external_exports.object({
  strategy: external_exports.enum(ISSUE_TREE_HOLD_RELEASE_POLICY_STRATEGIES).default("manual"),
  note: external_exports.string().trim().min(1).max(500).optional().nullable()
}).strict();
var previewIssueTreeControlSchema = external_exports.object({
  mode: issueTreeControlModeSchema,
  releasePolicy: issueTreeHoldReleasePolicySchema.optional().nullable()
}).strict();
var createIssueTreeHoldSchema = external_exports.object({
  mode: issueTreeControlModeSchema,
  reason: external_exports.string().trim().min(1).max(1e3).optional().nullable(),
  releasePolicy: issueTreeHoldReleasePolicySchema.optional().nullable(),
  metadata: external_exports.record(external_exports.string(), external_exports.unknown()).optional().nullable()
}).strict();
var releaseIssueTreeHoldSchema = external_exports.object({
  reason: external_exports.string().trim().min(1).max(1e3).optional().nullable(),
  releasePolicy: issueTreeHoldReleasePolicySchema.optional().nullable(),
  metadata: external_exports.record(external_exports.string(), external_exports.unknown()).optional().nullable()
}).strict();

// ../../node_modules/.pnpm/@paperclipai+shared@2026.722.0/node_modules/@paperclipai/shared/dist/validators/workspace-file-resource.js
var workspaceFileListSearchMaxBytes = 128;
function utf8ByteLength(value) {
  return new TextEncoder().encode(value).length;
}
var workspaceFileWorkspaceKindSchema = external_exports.enum(["execution_workspace", "project_workspace"]);
var workspaceFileSelectorSchema = external_exports.enum(["auto", "execution", "project"]).default("auto");
var workspaceFileListModeSchema = external_exports.enum(["all", "recent", "changed"]).default("all");
var workspaceFilePreviewKindSchema = external_exports.enum(["text", "image", "video", "pdf", "unsupported"]);
var workspaceFileResourceKindSchema = external_exports.enum(["file", "directory", "remote_resource"]);
var workspaceFileRefSchema = external_exports.object({
  kind: external_exports.literal("workspace_file"),
  issueId: external_exports.string().uuid().optional(),
  projectId: external_exports.string().uuid().optional(),
  projectName: external_exports.string().min(1).optional(),
  workspaceKind: workspaceFileWorkspaceKindSchema,
  workspaceId: external_exports.string().uuid(),
  relativePath: external_exports.string().min(1),
  line: external_exports.number().int().positive().nullable().optional(),
  column: external_exports.number().int().positive().nullable().optional(),
  displayPath: external_exports.string().min(1)
});
var workspaceFileResourceQuerySchema = external_exports.object({
  projectId: external_exports.string().uuid().optional(),
  workspaceId: external_exports.string().uuid().optional(),
  path: external_exports.string().min(1).refine((value) => !/[\x00-\x1f\x7f]/.test(value), {
    message: "Workspace file path contains an invalid character",
    params: { code: "invalid_path" }
  }),
  workspace: workspaceFileSelectorSchema.optional()
}).refine((value) => Boolean(value.projectId) === Boolean(value.workspaceId), {
  message: "Workspace file target requires both projectId and workspaceId",
  path: ["workspaceId"],
  params: { code: "invalid_target" }
});
var workspaceFileListQuerySchema = external_exports.object({
  projectId: external_exports.string().uuid().optional(),
  workspaceId: external_exports.string().uuid().optional(),
  workspace: workspaceFileSelectorSchema.optional(),
  path: external_exports.string().min(1).refine((value) => !/[\x00-\x1f\x7f]/.test(value), {
    message: "Workspace folder path contains an invalid character",
    params: { code: "invalid_path" }
  }).optional(),
  mode: workspaceFileListModeSchema.optional(),
  q: external_exports.string().refine((value) => !/[\x00-\x1f\x7f]/.test(value), {
    message: "Workspace file search contains an invalid character",
    params: { code: "invalid_query" }
  }).refine((value) => utf8ByteLength(value.trim()) <= workspaceFileListSearchMaxBytes, {
    message: "Workspace file search is too long",
    params: { code: "invalid_query" }
  }).optional(),
  limit: external_exports.coerce.number().int().min(1).max(100).default(25),
  offset: external_exports.coerce.number().int().min(0).max(1e4).default(0)
}).refine((value) => Boolean(value.projectId) === Boolean(value.workspaceId), {
  message: "Workspace file target requires both projectId and workspaceId",
  path: ["workspaceId"],
  params: { code: "invalid_target" }
});
var resolvedWorkspaceResourceSchema = external_exports.object({
  kind: workspaceFileResourceKindSchema,
  provider: external_exports.string().min(1),
  title: external_exports.string().min(1),
  displayPath: external_exports.string().min(1),
  workspaceLabel: external_exports.string().min(1),
  workspaceKind: workspaceFileWorkspaceKindSchema,
  workspaceId: external_exports.string().uuid(),
  projectId: external_exports.string().uuid().nullable().optional(),
  projectName: external_exports.string().min(1).nullable().optional(),
  contentType: external_exports.string().nullable().optional(),
  byteSize: external_exports.number().int().nonnegative().nullable().optional(),
  previewKind: workspaceFilePreviewKindSchema,
  denialReason: external_exports.string().nullable().optional(),
  capabilities: external_exports.object({
    preview: external_exports.boolean(),
    download: external_exports.boolean(),
    listChildren: external_exports.boolean()
  })
});
var workspaceFileContentSchema = external_exports.object({
  resource: resolvedWorkspaceResourceSchema,
  content: external_exports.object({
    encoding: external_exports.enum(["utf8", "base64"]),
    data: external_exports.string()
  })
});

// ../../node_modules/.pnpm/@paperclipai+shared@2026.722.0/node_modules/@paperclipai/shared/dist/validators/work-product.js
function attachmentContentPath(attachmentId) {
  return `/api/attachments/${attachmentId}/content`;
}
var issueWorkProductTypeSchema = external_exports.enum([
  "preview_url",
  "runtime_service",
  "pull_request",
  "branch",
  "commit",
  "artifact",
  "document"
]);
var issueWorkProductStatusSchema = external_exports.enum([
  "active",
  "ready_for_review",
  "approved",
  "changes_requested",
  "merged",
  "closed",
  "failed",
  "archived",
  "draft"
]);
var issueWorkProductReviewStateSchema = external_exports.enum([
  "none",
  "needs_board_review",
  "approved",
  "changes_requested"
]);
var attachmentArtifactWorkProductMetadataSchema = external_exports.object({
  attachmentId: external_exports.string().uuid(),
  contentType: external_exports.string().min(1),
  byteSize: external_exports.number().int().nonnegative(),
  contentPath: external_exports.string().min(1),
  openPath: external_exports.string().min(1),
  downloadPath: external_exports.string().min(1),
  originalFilename: external_exports.string().optional().nullable()
}).superRefine((value, ctx) => {
  const contentPath = attachmentContentPath(value.attachmentId);
  if (value.contentPath !== contentPath) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["contentPath"],
      message: "contentPath must point to the same-origin attachment content route"
    });
  }
  if (value.openPath !== contentPath) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["openPath"],
      message: "openPath must point to the same-origin attachment content route"
    });
  }
  if (value.downloadPath !== `${contentPath}?download=1`) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["downloadPath"],
      message: "downloadPath must point to the same-origin attachment download route"
    });
  }
});
var issueWorkProductMetadataSchema = external_exports.object({
  resourceRef: workspaceFileRefSchema.optional().nullable()
}).passthrough();
var createIssueWorkProductSchema = external_exports.object({
  projectId: external_exports.string().uuid().optional().nullable(),
  executionWorkspaceId: external_exports.string().uuid().optional().nullable(),
  runtimeServiceId: external_exports.string().uuid().optional().nullable(),
  type: issueWorkProductTypeSchema,
  provider: external_exports.string().min(1),
  externalId: external_exports.string().optional().nullable(),
  title: external_exports.string().min(1),
  url: external_exports.string().url().optional().nullable(),
  status: issueWorkProductStatusSchema.default("active"),
  reviewState: issueWorkProductReviewStateSchema.optional().default("none"),
  isPrimary: external_exports.boolean().optional().default(false),
  healthStatus: external_exports.enum(["unknown", "healthy", "unhealthy"]).optional().default("unknown"),
  summary: external_exports.string().optional().nullable(),
  metadata: issueWorkProductMetadataSchema.optional().nullable(),
  createdByRunId: external_exports.string().uuid().optional().nullable()
});
var updateIssueWorkProductSchema = createIssueWorkProductSchema.partial();

// ../../node_modules/.pnpm/@paperclipai+shared@2026.722.0/node_modules/@paperclipai/shared/dist/validators/artifact.js
var COMPANY_ARTIFACTS_DEFAULT_LIMIT = 30;
var COMPANY_ARTIFACTS_MAX_LIMIT = 100;
var COMPANY_ARTIFACTS_MAX_QUERY_LENGTH = 160;
var companyArtifactSourceSchema = external_exports.enum(["document", "attachment", "work_product"]);
var companyArtifactMediaKindSchema = external_exports.enum(["image", "video", "text", "document", "file", "empty"]);
var companyArtifactGroupBySchema = external_exports.enum(["none", "task", "parent_task"]);
var companyArtifactsQuerySchema = external_exports.object({
  kind: external_exports.enum(["image", "video", "text", "document", "file", "all"]).optional().default("all"),
  projectId: external_exports.string().uuid().optional(),
  q: external_exports.string().trim().max(COMPANY_ARTIFACTS_MAX_QUERY_LENGTH).optional(),
  groupBy: companyArtifactGroupBySchema.optional().default("none"),
  groupIssueId: external_exports.string().uuid().optional(),
  limit: external_exports.coerce.number().int().min(1).max(COMPANY_ARTIFACTS_MAX_LIMIT).optional().default(COMPANY_ARTIFACTS_DEFAULT_LIMIT),
  cursor: external_exports.string().min(1).optional()
});
var companyArtifactSchema = external_exports.object({
  id: external_exports.string().min(1),
  source: companyArtifactSourceSchema,
  mediaKind: companyArtifactMediaKindSchema,
  title: external_exports.string(),
  previewText: external_exports.string().nullable(),
  contentType: external_exports.string().nullable(),
  contentPath: external_exports.string().nullable(),
  openPath: external_exports.string().nullable(),
  downloadPath: external_exports.string().nullable(),
  issue: external_exports.object({
    id: external_exports.string().uuid(),
    identifier: external_exports.string(),
    title: external_exports.string()
  }),
  project: external_exports.object({
    id: external_exports.string().uuid(),
    name: external_exports.string()
  }).nullable(),
  createdByAgent: external_exports.object({
    id: external_exports.string().uuid(),
    name: external_exports.string()
  }).nullable(),
  updatedAt: external_exports.string().datetime(),
  href: external_exports.string().min(1)
});
var companyArtifactGroupSchema = external_exports.object({
  id: external_exports.string().min(1),
  groupBy: companyArtifactGroupBySchema.exclude(["none"]),
  issue: external_exports.object({
    id: external_exports.string().uuid(),
    identifier: external_exports.string(),
    title: external_exports.string()
  }),
  title: external_exports.string(),
  count: external_exports.number().int().min(0),
  mediaKinds: external_exports.array(companyArtifactMediaKindSchema),
  previewArtifacts: external_exports.array(companyArtifactSchema),
  updatedAt: external_exports.string().datetime(),
  href: external_exports.string().min(1)
});
var companyArtifactsResponseSchema = external_exports.object({
  artifacts: external_exports.array(companyArtifactSchema),
  groups: external_exports.array(companyArtifactGroupSchema).optional(),
  selectedGroup: companyArtifactGroupSchema.nullable().optional(),
  nextCursor: external_exports.string().nullable()
});

// ../../node_modules/.pnpm/@paperclipai+shared@2026.722.0/node_modules/@paperclipai/shared/dist/validators/goal.js
var createGoalSchema = external_exports.object({
  title: external_exports.string().min(1),
  description: external_exports.string().optional().nullable(),
  level: external_exports.enum(GOAL_LEVELS).optional().default("task"),
  status: external_exports.enum(GOAL_STATUSES).optional().default("planned"),
  parentId: external_exports.string().uuid().optional().nullable(),
  ownerAgentId: external_exports.string().uuid().optional().nullable()
});
var updateGoalSchema = createGoalSchema.partial();

// ../../node_modules/.pnpm/@paperclipai+shared@2026.722.0/node_modules/@paperclipai/shared/dist/validators/approval.js
var createApprovalSchema = external_exports.object({
  type: external_exports.enum(APPROVAL_TYPES),
  requestedByAgentId: external_exports.string().uuid().optional().nullable(),
  payload: external_exports.record(external_exports.string(), external_exports.unknown()),
  issueIds: external_exports.array(external_exports.string().uuid()).optional()
});
var resolveApprovalSchema = external_exports.object({
  decisionNote: multilineTextSchema.optional().nullable()
});
var requestApprovalRevisionSchema = external_exports.object({
  decisionNote: multilineTextSchema.optional().nullable()
});
var resubmitApprovalSchema = external_exports.object({
  payload: external_exports.record(external_exports.string(), external_exports.unknown()).optional()
});
var addApprovalCommentSchema = external_exports.object({
  body: multilineTextSchema.pipe(external_exports.string().min(1))
});

// ../../node_modules/.pnpm/@paperclipai+shared@2026.722.0/node_modules/@paperclipai/shared/dist/validators/cost.js
var createCostEventSchema = external_exports.object({
  agentId: external_exports.string().uuid(),
  issueId: external_exports.string().uuid().optional().nullable(),
  projectId: external_exports.string().uuid().optional().nullable(),
  goalId: external_exports.string().uuid().optional().nullable(),
  heartbeatRunId: external_exports.string().uuid().optional().nullable(),
  billingCode: external_exports.string().optional().nullable(),
  provider: external_exports.string().min(1),
  biller: external_exports.string().min(1).optional(),
  billingType: external_exports.enum(BILLING_TYPES).optional().default("unknown"),
  costStatus: external_exports.enum(COST_STATUSES).optional().default("reported"),
  model: external_exports.string().min(1),
  inputTokens: external_exports.number().int().nonnegative().optional().default(0),
  cachedInputTokens: external_exports.number().int().nonnegative().optional().default(0),
  outputTokens: external_exports.number().int().nonnegative().optional().default(0),
  costCents: external_exports.number().int().nonnegative(),
  occurredAt: external_exports.string().datetime()
}).transform((value) => ({
  ...value,
  biller: value.biller ?? value.provider
}));
var updateBudgetSchema = external_exports.object({
  budgetMonthlyCents: external_exports.number().int().nonnegative()
});

// ../../node_modules/.pnpm/@paperclipai+shared@2026.722.0/node_modules/@paperclipai/shared/dist/validators/finance.js
var createFinanceEventSchema = external_exports.object({
  agentId: external_exports.string().uuid().optional().nullable(),
  issueId: external_exports.string().uuid().optional().nullable(),
  projectId: external_exports.string().uuid().optional().nullable(),
  goalId: external_exports.string().uuid().optional().nullable(),
  heartbeatRunId: external_exports.string().uuid().optional().nullable(),
  costEventId: external_exports.string().uuid().optional().nullable(),
  billingCode: external_exports.string().optional().nullable(),
  description: external_exports.string().max(500).optional().nullable(),
  eventKind: external_exports.enum(FINANCE_EVENT_KINDS),
  direction: external_exports.enum(FINANCE_DIRECTIONS).optional().default("debit"),
  biller: external_exports.string().min(1),
  provider: external_exports.string().min(1).optional().nullable(),
  executionAdapterType: external_exports.enum(AGENT_ADAPTER_TYPES).optional().nullable(),
  pricingTier: external_exports.string().min(1).optional().nullable(),
  region: external_exports.string().min(1).optional().nullable(),
  model: external_exports.string().min(1).optional().nullable(),
  quantity: external_exports.number().int().nonnegative().optional().nullable(),
  unit: external_exports.enum(FINANCE_UNITS).optional().nullable(),
  amountCents: external_exports.number().int().nonnegative(),
  currency: external_exports.string().length(3).optional().default("USD"),
  estimated: external_exports.boolean().optional().default(false),
  externalInvoiceId: external_exports.string().optional().nullable(),
  metadataJson: external_exports.record(external_exports.string(), external_exports.unknown()).optional().nullable(),
  occurredAt: external_exports.string().datetime()
}).transform((value) => ({
  ...value,
  currency: value.currency.toUpperCase()
}));

// ../../node_modules/.pnpm/@paperclipai+shared@2026.722.0/node_modules/@paperclipai/shared/dist/validators/asset.js
var createAssetImageMetadataSchema = external_exports.object({
  namespace: external_exports.string().trim().min(1).max(120).regex(/^[a-zA-Z0-9/_-]+$/).optional()
});

// ../../node_modules/.pnpm/@paperclipai+shared@2026.722.0/node_modules/@paperclipai/shared/dist/validators/pipeline.js
var routineVariableLikeNameSchema = external_exports.string().trim().regex(/^[A-Za-z][A-Za-z0-9_]*$/);
var pipelineStageKindSchema = external_exports.enum(["working", "review", "done", "cancelled"]);
var legacyPipelineStageKindSchema = external_exports.enum(["open", "working", "review", "done", "cancelled"]);
var pipelineStageApproverSchema = external_exports.object({
  kind: external_exports.enum(["any_human", "user", "agent"]).optional().default("any_human"),
  id: external_exports.string().trim().min(1).max(200).optional()
}).superRefine((value, ctx) => {
  if (value.kind !== "any_human" && (typeof value.id !== "string" || value.id.length === 0)) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["id"],
      message: "Specific stage approvers require an id"
    });
  }
});
var pipelineStageOnEnterSchema = external_exports.object({
  type: external_exports.literal("run_routine"),
  routineId: external_exports.string().uuid(),
  id: external_exports.string().trim().min(1).max(200).optional(),
  projectId: external_exports.string().uuid().optional().nullable(),
  projectWorkspaceId: external_exports.string().uuid().optional().nullable(),
  executionWorkspaceId: external_exports.string().uuid().optional().nullable(),
  executionWorkspacePreference: external_exports.enum(ISSUE_EXECUTION_WORKSPACE_PREFERENCES).optional().nullable(),
  executionWorkspaceSettings: issueExecutionWorkspaceSettingsSchema.optional().nullable()
}).passthrough();
var pipelineStageAutomationSchema = external_exports.object({
  routineId: external_exports.string().uuid().optional().nullable(),
  assigneeAgentId: external_exports.string().uuid().optional().nullable(),
  instructionsBody: external_exports.string().optional().nullable(),
  projectId: external_exports.string().uuid().optional().nullable(),
  projectWorkspaceId: external_exports.string().uuid().optional().nullable(),
  executionWorkspaceId: external_exports.string().uuid().optional().nullable(),
  executionWorkspacePreference: external_exports.enum(ISSUE_EXECUTION_WORKSPACE_PREFERENCES).optional().nullable(),
  executionWorkspaceSettings: issueExecutionWorkspaceSettingsSchema.optional().nullable()
}).passthrough();
var pipelineStageCarryOverPolicySchema = external_exports.object({
  version: external_exports.literal(1).default(1),
  mode: external_exports.enum(["all_except", "only"]).default("all_except"),
  includeFields: external_exports.array(routineVariableLikeNameSchema).max(100).default([]),
  excludeFields: external_exports.array(routineVariableLikeNameSchema).max(100).default([])
});
var pipelineStageBreakdownSchema = external_exports.object({
  targetPipelineId: external_exports.string().uuid(),
  targetStageKey: external_exports.string().trim().min(1).max(120),
  pieceNoun: external_exports.string().trim().min(1).max(80).default("piece"),
  carryOverPolicy: pipelineStageCarryOverPolicySchema.optional(),
  inheritFields: external_exports.array(routineVariableLikeNameSchema).max(100).default([]),
  advanceTo: external_exports.string().trim().min(1).max(120).optional(),
  waitForPieces: external_exports.boolean().optional().default(false),
  whenFinishedMoveTo: external_exports.string().trim().min(1).max(120).optional()
}).superRefine((value, ctx) => {
  if (value.waitForPieces && !value.whenFinishedMoveTo) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["whenFinishedMoveTo"],
      message: "Breakdown stages that wait for pieces need a destination stage"
    });
  }
});
var pipelineStageVariableSchema = external_exports.object({
  key: routineVariableLikeNameSchema,
  label: external_exports.string().trim().max(120),
  type: external_exports.enum(["select", "text", "multiline"]).default("text"),
  options: external_exports.array(external_exports.string().trim().min(1).max(120)).max(50).optional().default([]),
  required: external_exports.boolean().optional().default(false),
  showInAddForm: external_exports.boolean().optional().default(false)
}).superRefine((value, ctx) => {
  if (value.type === "select" && value.options.length === 0) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["options"],
      message: "Select variables require at least one option"
    });
  }
  if (value.type !== "select" && value.options.length > 0) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["options"],
      message: "Only select variables can define options"
    });
  }
});
var pipelineStageConfigSchema = external_exports.object({
  variables: external_exports.array(pipelineStageVariableSchema).default([]),
  disabled: external_exports.boolean().optional(),
  disabledReason: external_exports.string().trim().max(1e3).nullable().optional(),
  requireApproval: external_exports.boolean().optional(),
  approver: pipelineStageApproverSchema.optional(),
  /** Legacy input only; the server migrates it to requireApproval/approver. */
  reviewerKind: external_exports.enum(["human", "any"]).optional(),
  whatHappensHere: external_exports.string().trim().max(1e4).optional(),
  onEnter: pipelineStageOnEnterSchema.optional(),
  automation: pipelineStageAutomationSchema.optional(),
  breakdown: pipelineStageBreakdownSchema.optional(),
  approveToStageKey: external_exports.string().trim().min(1).max(120).optional(),
  rejectToStageKey: external_exports.string().trim().min(1).max(120).optional(),
  requestChangesToStageKey: external_exports.string().trim().min(1).max(120).optional(),
  requireRejectReason: external_exports.boolean().optional(),
  requireRequestChangesReason: external_exports.boolean().optional(),
  requireChildrenTerminal: external_exports.boolean().optional(),
  requireNoUnresolvedDrift: external_exports.boolean().optional()
}).passthrough().superRefine((value, ctx) => {
  const keys = /* @__PURE__ */ new Set();
  value.variables.forEach((variable, index) => {
    if (keys.has(variable.key)) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        path: ["variables", index, "key"],
        message: "Pipeline stage variable keys must be unique"
      });
    }
    keys.add(variable.key);
  });
});
var pipelineAutomationRetryScopeSchema = external_exports.enum(["current_stage", "previous_stage"]);
var pipelineAutomationRetryCleanupOptionsSchema = external_exports.object({
  retireDirectChildren: external_exports.boolean().default(true),
  retireDescendants: external_exports.boolean().default(true),
  cancelLinkedAutomationIssues: external_exports.boolean().default(true)
});
var pipelineAutomationRetryRequestSchema = external_exports.object({
  scope: pipelineAutomationRetryScopeSchema,
  targetStageId: external_exports.string().uuid().nullable().optional(),
  expectedVersion: external_exports.number().int().positive(),
  cleanup: pipelineAutomationRetryCleanupOptionsSchema.default({
    retireDirectChildren: true,
    retireDescendants: true,
    cancelLinkedAutomationIssues: true
  })
});

// ../../node_modules/.pnpm/@paperclipai+shared@2026.722.0/node_modules/@paperclipai/shared/dist/validators/access.js
var createCompanyInviteSchema = external_exports.object({
  allowedJoinTypes: external_exports.enum(INVITE_JOIN_TYPES).default("both"),
  humanRole: external_exports.enum(HUMAN_COMPANY_MEMBERSHIP_ROLES).optional().nullable(),
  defaultsPayload: external_exports.record(external_exports.string(), external_exports.unknown()).optional().nullable(),
  agentMessage: external_exports.string().max(4e3).optional().nullable()
});
var createOpenClawInvitePromptSchema = external_exports.object({
  agentMessage: external_exports.string().max(4e3).optional().nullable()
});
var acceptInviteSchema = external_exports.object({
  requestType: external_exports.enum(JOIN_REQUEST_TYPES),
  agentName: external_exports.string().min(1).max(120).optional(),
  adapterType: optionalAgentAdapterTypeSchema,
  capabilities: external_exports.string().max(4e3).optional().nullable(),
  agentDefaultsPayload: external_exports.record(external_exports.string(), external_exports.unknown()).optional().nullable(),
  // OpenClaw join compatibility fields accepted at top level.
  responsesWebhookUrl: external_exports.string().max(4e3).optional().nullable(),
  responsesWebhookMethod: external_exports.string().max(32).optional().nullable(),
  responsesWebhookHeaders: external_exports.record(external_exports.string(), external_exports.unknown()).optional().nullable(),
  paperclipApiUrl: external_exports.string().max(4e3).optional().nullable(),
  webhookAuthHeader: external_exports.string().max(4e3).optional().nullable()
});
var listJoinRequestsQuerySchema = external_exports.object({
  status: external_exports.enum(JOIN_REQUEST_STATUSES).optional(),
  requestType: external_exports.enum(JOIN_REQUEST_TYPES).optional()
});
var listCompanyInvitesQuerySchema = external_exports.object({
  state: external_exports.enum(["active", "revoked", "accepted", "expired"]).optional(),
  limit: external_exports.coerce.number().int().min(1).max(100).optional().default(20),
  offset: external_exports.coerce.number().int().min(0).optional().default(0)
});
var claimJoinRequestApiKeySchema = external_exports.object({
  claimSecret: external_exports.string().min(16).max(256)
});
var boardCliAuthAccessLevelSchema = external_exports.enum([
  "board",
  "instance_admin_required"
]);
var createCliAuthChallengeSchema = external_exports.object({
  command: external_exports.string().min(1).max(240),
  clientName: external_exports.string().max(120).optional().nullable(),
  requestedAccess: boardCliAuthAccessLevelSchema.default("board"),
  requestedCompanyId: external_exports.string().uuid().optional().nullable()
});
var resolveCliAuthChallengeSchema = external_exports.object({
  token: external_exports.string().min(16).max(256)
});
var createBoardApiKeySchema = external_exports.object({
  name: external_exports.string().trim().min(1).max(120).default("paperclipai cli"),
  expiresAt: external_exports.coerce.date().optional().nullable(),
  requestedCompanyId: external_exports.string().uuid().optional().nullable()
});
var updateMemberPermissionsSchema = external_exports.object({
  grants: external_exports.array(external_exports.object({
    permissionKey: external_exports.enum(PERMISSION_KEYS),
    scope: external_exports.record(external_exports.string(), external_exports.unknown()).optional().nullable()
  }))
});
var editableMembershipStatuses = ["pending", "active", "suspended"];
var updateCompanyMemberSchema = external_exports.object({
  membershipRole: external_exports.enum(HUMAN_COMPANY_MEMBERSHIP_ROLES).optional().nullable(),
  status: external_exports.enum(editableMembershipStatuses).optional()
}).refine((value) => value.membershipRole !== void 0 || value.status !== void 0, {
  message: "membershipRole or status is required"
});
var updateCompanyMemberWithPermissionsSchema = external_exports.object({
  membershipRole: external_exports.enum(HUMAN_COMPANY_MEMBERSHIP_ROLES).optional().nullable(),
  status: external_exports.enum(editableMembershipStatuses).optional(),
  grants: updateMemberPermissionsSchema.shape.grants.default([])
}).refine((value) => value.membershipRole !== void 0 || value.status !== void 0, {
  message: "membershipRole or status is required"
});
var archiveCompanyMemberSchema = external_exports.object({
  reassignment: external_exports.object({
    assigneeAgentId: external_exports.string().uuid().optional().nullable(),
    assigneeUserId: external_exports.string().uuid().optional().nullable()
  }).optional().nullable()
}).superRefine((value, ctx) => {
  if (value.reassignment?.assigneeAgentId && value.reassignment.assigneeUserId) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      message: "Choose either an agent or user reassignment target",
      path: ["reassignment"]
    });
  }
});
var updateUserCompanyAccessSchema = external_exports.object({
  companyIds: external_exports.array(external_exports.string().uuid()).default([])
});
var searchAdminUsersQuerySchema = external_exports.object({
  query: external_exports.string().trim().max(120).optional().default("")
});
var profileImageAssetPathPattern = /^\/api\/assets\/[^/?#]+\/content(?:\?[^#]*)?(?:#.*)?$/;
function isValidProfileImage(value) {
  if (profileImageAssetPathPattern.test(value))
    return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
var profileImageSchema = external_exports.string().trim().min(1).max(4e3).refine(isValidProfileImage, { message: "Invalid profile image URL" });
var currentUserProfileSchema = external_exports.object({
  id: external_exports.string().min(1),
  email: external_exports.preprocess((v) => typeof v === "string" && v.trim() === "" ? null : v, external_exports.string().email().nullable()),
  name: external_exports.preprocess((v) => typeof v === "string" && v.trim() === "" ? null : v, external_exports.string().min(1).max(120).nullable()),
  image: profileImageSchema.nullable()
});
var authSessionSchema = external_exports.object({
  session: external_exports.object({
    id: external_exports.string().min(1),
    userId: external_exports.string().min(1)
  }),
  user: currentUserProfileSchema
});
var updateCurrentUserProfileSchema = external_exports.object({
  name: external_exports.string().trim().min(1).max(120),
  image: external_exports.union([profileImageSchema, external_exports.literal(""), external_exports.null()]).optional().transform((value) => value === "" ? null : value)
});

// ../../node_modules/.pnpm/@paperclipai+shared@2026.722.0/node_modules/@paperclipai/shared/dist/validators/skill-policy.js
var SKILL_POLICY_ACTIONS = [
  "skills.create",
  "skills.import",
  "skills.install",
  "skills.edit",
  "skills.update",
  "skills.test",
  "skills.reset",
  "skills.remove"
];
var SKILL_POLICY_SOURCE_TYPES = [
  "workspace",
  "catalog",
  "git",
  "external_package",
  "generated",
  "unknown"
];
var skillPolicyActionSchema = external_exports.enum(SKILL_POLICY_ACTIONS);
var skillPolicySourceTypeSchema = external_exports.enum(SKILL_POLICY_SOURCE_TYPES);
var skillPolicyEffectSchema = external_exports.enum(["allow", "deny"]);
var nonEmptyUniqueStrings = external_exports.array(external_exports.string().trim().min(1).max(512)).min(1).max(500).refine((values) => new Set(values).size === values.length, "Values must be unique");
function isSafeSourceLocator(value) {
  if (/:\/\/[^/@\s]+:[^/@\s]+@/.test(value))
    return false;
  try {
    const url = new URL(value);
    if (url.username || url.password)
      return false;
    const credentialParameter = /token|secret|password|api[-_]?key|authorization/i;
    if ([...url.searchParams.keys()].some((key) => credentialParameter.test(key)))
      return false;
    const fragment = url.hash.slice(1);
    return !/(?:^|[?&;])(?:token|secret|password|api[-_]?key|authorization)=/i.test(fragment);
  } catch {
    return true;
  }
}
function normalizeSkillPolicySourceLocator(value) {
  const trimmed = value.trim();
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return trimmed;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:")
    return trimmed;
  const hostname = url.hostname.toLowerCase() === "www.github.com" ? "github.com" : url.hostname.toLowerCase();
  const segments = url.pathname.split("/").filter(Boolean);
  const isRepoStyle = url.protocol === "https:" && !hostname.endsWith(".githubusercontent.com") && hostname !== "gist.github.com" && segments.length >= 2 && !url.pathname.endsWith(".md") && !url.username && !url.password && !url.search && !url.hash;
  if (!isRepoStyle)
    return url.toString();
  const owner = segments[0].toLowerCase();
  const repo = segments[1].replace(/\.git$/i, "").toLowerCase();
  const suffix = segments.slice(2).join("/");
  return `https://${hostname}/${owner}/${repo}${suffix ? `/${suffix}` : ""}`;
}
var skillPolicySourceLocatorSchema = external_exports.string().trim().min(1).max(2048).refine(isSafeSourceLocator, "Source locators must not contain credentials or secret query or fragment parameters").transform(normalizeSkillPolicySourceLocator);
var skillPolicySubjectSchema = external_exports.discriminatedUnion("type", [
  external_exports.object({ type: external_exports.literal("all_agents") }).strict(),
  external_exports.object({
    type: external_exports.literal("agents"),
    agentIds: external_exports.array(external_exports.string().uuid()).min(1).max(500).refine((values) => new Set(values).size === values.length, "Agent IDs must be unique")
  }).strict(),
  external_exports.object({ type: external_exports.literal("roles"), roles: nonEmptyUniqueStrings }).strict()
]);
var skillPolicyResourceSelectorSchema = external_exports.object({
  skillIds: external_exports.array(external_exports.string().uuid()).min(1).max(500).optional(),
  skillKeys: nonEmptyUniqueStrings.optional(),
  sourceTypes: external_exports.array(skillPolicySourceTypeSchema).min(1).refine((values) => new Set(values).size === values.length, "Source types must be unique").optional(),
  sourceLocators: external_exports.array(skillPolicySourceLocatorSchema).min(1).max(500).refine((values) => new Set(values).size === values.length, "Source locators must be unique").optional()
}).strict().refine((value) => Object.keys(value).length > 0, "At least one resource selector is required");
var skillPolicyRuleSchema = external_exports.object({
  id: external_exports.string().trim().min(1).max(128).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/),
  priority: external_exports.number().int().min(-1e6).max(1e6),
  effect: skillPolicyEffectSchema,
  subject: skillPolicySubjectSchema,
  actions: external_exports.array(skillPolicyActionSchema).min(1).refine((values) => new Set(values).size === values.length, "Actions must be unique"),
  resources: skillPolicyResourceSelectorSchema.optional()
}).strict();
var skillPolicyDocumentSchema = external_exports.object({
  schemaVersion: external_exports.literal(1),
  defaultEffect: skillPolicyEffectSchema,
  rules: external_exports.array(skillPolicyRuleSchema).max(1e3).refine((rules) => new Set(rules.map((rule) => rule.id)).size === rules.length, "Rule IDs must be unique")
}).strict();
var replaceSkillPolicySchema = skillPolicyDocumentSchema.extend({
  expectedRevision: external_exports.number().int().nonnegative()
}).strict();
var skillPolicyEvaluationResourceSchema = external_exports.object({
  skillId: external_exports.string().uuid().optional(),
  skillKey: external_exports.string().trim().min(1).max(512).optional(),
  sourceType: skillPolicySourceTypeSchema.optional(),
  sourceLocator: skillPolicySourceLocatorSchema.optional()
}).strict();
var evaluateSkillPolicySchema = external_exports.object({
  action: skillPolicyActionSchema,
  resource: skillPolicyEvaluationResourceSchema.default({}),
  principal: external_exports.object({ agentId: external_exports.string().uuid() }).strict().optional()
}).strict();

// ../../node_modules/.pnpm/@paperclipai+shared@2026.722.0/node_modules/@paperclipai/shared/dist/api.js
var API_PREFIX = "/api";
var API = {
  health: `${API_PREFIX}/health`,
  companies: `${API_PREFIX}/companies`,
  companyFolders: `${API_PREFIX}/companies/:companyId/folders`,
  companyFolder: `${API_PREFIX}/companies/:companyId/folders/:folderId`,
  companyFolderMove: `${API_PREFIX}/companies/:companyId/folders/:folderId/move`,
  companyFolderItemMove: `${API_PREFIX}/companies/:companyId/folders/items/move`,
  agents: `${API_PREFIX}/agents`,
  projects: `${API_PREFIX}/projects`,
  environments: `${API_PREFIX}/environments`,
  environmentDeleteBlastRadius: `${API_PREFIX}/environments/:id/delete-blast-radius`,
  environmentCustomImageTemplate: `${API_PREFIX}/environments/:environmentId/custom-image-template`,
  environmentCustomImageTemplateDisable: `${API_PREFIX}/environments/:environmentId/custom-image-template`,
  environmentCustomImageTemplateRollback: `${API_PREFIX}/environments/:environmentId/custom-image-template/rollback`,
  environmentCustomImageSetupSessions: `${API_PREFIX}/environments/:environmentId/custom-image-setup-sessions`,
  environmentCustomImageSetupSession: `${API_PREFIX}/environment-custom-image-setup-sessions/:sessionId`,
  environmentCustomImageSetupSessionTerminalToken: `${API_PREFIX}/environment-custom-image-setup-sessions/:sessionId/terminal-session-token`,
  environmentCustomImageSetupSessionTerminalWs: `${API_PREFIX}/environment-custom-image-setup-sessions/:sessionId/terminal/ws`,
  environmentCustomImageSetupSessionFinish: `${API_PREFIX}/environment-custom-image-setup-sessions/:sessionId/finish`,
  environmentCustomImageSetupSessionCancel: `${API_PREFIX}/environment-custom-image-setup-sessions/:sessionId/cancel`,
  issues: `${API_PREFIX}/issues`,
  issueWatchdog: `${API_PREFIX}/issues/:issueId/watchdog`,
  issueTreeControl: `${API_PREFIX}/issues/:issueId/tree-control`,
  issueTreeHolds: `${API_PREFIX}/issues/:issueId/tree-holds`,
  summarySlot: `${API_PREFIX}/companies/:companyId/summary-slots/:scopeKind/:slotKey`,
  summarySlotRevisions: `${API_PREFIX}/companies/:companyId/summary-slots/:scopeKind/:slotKey/revisions`,
  summarySlotGenerate: `${API_PREFIX}/companies/:companyId/summary-slots/:scopeKind/:slotKey/generate`,
  goals: `${API_PREFIX}/goals`,
  approvals: `${API_PREFIX}/approvals`,
  secrets: `${API_PREFIX}/secrets`,
  tools: `${API_PREFIX}/companies/:companyId/tools`,
  toolExamples: `${API_PREFIX}/companies/:companyId/tools/examples`,
  toolApplications: `${API_PREFIX}/companies/:companyId/tools/applications`,
  toolConnections: `${API_PREFIX}/companies/:companyId/tools/connections`,
  toolCatalog: `${API_PREFIX}/companies/:companyId/tools/catalog`,
  toolProfiles: `${API_PREFIX}/companies/:companyId/tools/profiles`,
  toolPolicies: `${API_PREFIX}/companies/:companyId/tools/policies`,
  toolAudit: `${API_PREFIX}/companies/:companyId/tools/audit`,
  toolRuntimeSlots: `${API_PREFIX}/companies/:companyId/tools/runtime-slots`,
  toolRuntimeSlotStop: `${API_PREFIX}/companies/:companyId/tools/runtime-slots/:id/stop`,
  toolRuntimeSlotRestart: `${API_PREFIX}/companies/:companyId/tools/runtime-slots/:id/restart`,
  toolRuntimeHealth: `${API_PREFIX}/companies/:companyId/tools/runtime-health`,
  toolGateway: `${API_PREFIX}/tool-gateway`,
  smokeLab: `${API_PREFIX}/companies/:companyId/smoke-lab`,
  smokeLabServices: `${API_PREFIX}/companies/:companyId/smoke-lab/services`,
  smokeLabInstallFixtures: `${API_PREFIX}/companies/:companyId/smoke-lab/install-fixtures`,
  smokeLabRuns: `${API_PREFIX}/companies/:companyId/smoke-lab/runs`,
  smokeLabRunSteps: `${API_PREFIX}/companies/:companyId/smoke-lab/runs/:runId/steps`,
  userSecretDefinitions: `${API_PREFIX}/companies/:companyId/user-secret-definitions`,
  userSecretDefinition: `${API_PREFIX}/companies/:companyId/user-secret-definitions/:definitionId`,
  userSecretDefinitionCoverage: `${API_PREFIX}/companies/:companyId/user-secret-definitions/:definitionId/coverage`,
  myUserSecrets: `${API_PREFIX}/companies/:companyId/me/user-secrets`,
  myUserSecret: `${API_PREFIX}/companies/:companyId/me/user-secrets/:secretId`,
  secretProviderConfigs: `${API_PREFIX}/secret-provider-configs`,
  secretProviderConfigDiscoveryPreview: `${API_PREFIX}/companies/:companyId/secret-provider-configs/discovery/preview`,
  costs: `${API_PREFIX}/costs`,
  activity: `${API_PREFIX}/activity`,
  dashboard: `${API_PREFIX}/dashboard`,
  sidebarBadges: `${API_PREFIX}/sidebar-badges`,
  sidebarPreferences: `${API_PREFIX}/sidebar-preferences`,
  resourceMemberships: `${API_PREFIX}/resource-memberships`,
  invites: `${API_PREFIX}/invites`,
  joinRequests: `${API_PREFIX}/join-requests`,
  members: `${API_PREFIX}/members`,
  admin: `${API_PREFIX}/admin`
};

// ../../node_modules/.pnpm/@paperclipai+shared@2026.722.0/node_modules/@paperclipai/shared/dist/config-schema.js
var configMetaSchema = external_exports.object({
  version: external_exports.literal(1),
  updatedAt: external_exports.string(),
  source: external_exports.enum(["onboard", "configure", "doctor"])
});
var llmConfigSchema = external_exports.object({
  provider: external_exports.enum(["claude", "openai"]),
  apiKey: external_exports.string().optional()
});
var databaseBackupConfigSchema = external_exports.object({
  enabled: external_exports.boolean().default(true),
  intervalMinutes: external_exports.number().int().min(1).max(7 * 24 * 60).default(60),
  retentionDays: external_exports.number().int().min(1).max(3650).default(7),
  dir: external_exports.string().default("~/.paperclip/instances/default/data/backups")
});
var databaseConfigSchema = external_exports.object({
  mode: external_exports.enum(["embedded-postgres", "postgres"]).default("embedded-postgres"),
  connectionString: external_exports.string().optional(),
  embeddedPostgresDataDir: external_exports.string().default("~/.paperclip/instances/default/db"),
  embeddedPostgresPort: external_exports.number().int().min(1).max(65535).default(54329),
  backup: databaseBackupConfigSchema.default({
    enabled: true,
    intervalMinutes: 60,
    retentionDays: 7,
    dir: "~/.paperclip/instances/default/data/backups"
  })
});
var loggingConfigSchema = external_exports.object({
  mode: external_exports.enum(["file", "cloud"]),
  logDir: external_exports.string().default("~/.paperclip/instances/default/logs")
});
var serverConfigSchema = external_exports.object({
  deploymentMode: external_exports.enum(DEPLOYMENT_MODES).default("local_trusted"),
  exposure: external_exports.enum(DEPLOYMENT_EXPOSURES).default("private"),
  bind: external_exports.enum(BIND_MODES).optional(),
  customBindHost: external_exports.string().optional(),
  host: external_exports.string().default("127.0.0.1"),
  port: external_exports.number().int().min(1).max(65535).default(3100),
  allowedHostnames: external_exports.array(external_exports.string().min(1)).default([]),
  serveUi: external_exports.boolean().default(true)
});
var authConfigSchema = external_exports.object({
  baseUrlMode: external_exports.enum(AUTH_BASE_URL_MODES).default("auto"),
  publicBaseUrl: external_exports.string().url().optional(),
  disableSignUp: external_exports.boolean().default(false)
});
var storageLocalDiskConfigSchema = external_exports.object({
  baseDir: external_exports.string().default("~/.paperclip/instances/default/data/storage")
});
var storageS3ConfigSchema = external_exports.object({
  bucket: external_exports.string().min(1).default("paperclip"),
  region: external_exports.string().min(1).default("us-east-1"),
  endpoint: external_exports.string().optional(),
  prefix: external_exports.string().default(""),
  forcePathStyle: external_exports.boolean().default(false)
});
var storageConfigSchema = external_exports.object({
  provider: external_exports.enum(STORAGE_PROVIDERS).default("local_disk"),
  localDisk: storageLocalDiskConfigSchema.default({
    baseDir: "~/.paperclip/instances/default/data/storage"
  }),
  s3: storageS3ConfigSchema.default({
    bucket: "paperclip",
    region: "us-east-1",
    prefix: "",
    forcePathStyle: false
  })
});
var secretsLocalEncryptedConfigSchema = external_exports.object({
  keyFilePath: external_exports.string().default("~/.paperclip/instances/default/secrets/master.key")
});
var secretsConfigSchema = external_exports.object({
  provider: external_exports.enum(SECRET_PROVIDERS).default("local_encrypted"),
  strictMode: external_exports.boolean().default(false),
  localEncrypted: secretsLocalEncryptedConfigSchema.default({
    keyFilePath: "~/.paperclip/instances/default/secrets/master.key"
  })
});
var telemetryConfigSchema = external_exports.object({
  enabled: external_exports.boolean().default(true)
}).default({});
var paperclipConfigSchema = external_exports.object({
  $meta: configMetaSchema,
  llm: llmConfigSchema.optional(),
  database: databaseConfigSchema,
  logging: loggingConfigSchema,
  server: serverConfigSchema,
  telemetry: telemetryConfigSchema,
  auth: authConfigSchema.default({
    baseUrlMode: "auto",
    disableSignUp: false
  }),
  storage: storageConfigSchema.default({
    provider: "local_disk",
    localDisk: {
      baseDir: "~/.paperclip/instances/default/data/storage"
    },
    s3: {
      bucket: "paperclip",
      region: "us-east-1",
      prefix: "",
      forcePathStyle: false
    }
  }),
  secrets: secretsConfigSchema.default({
    provider: "local_encrypted",
    strictMode: false,
    localEncrypted: {
      keyFilePath: "~/.paperclip/instances/default/secrets/master.key"
    }
  })
}).superRefine((value, ctx) => {
  if (value.server.deploymentMode === "local_trusted" && value.server.exposure !== "private") {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      message: "server.exposure must be private when deploymentMode is local_trusted",
      path: ["server", "exposure"]
    });
  }
  for (const message of validateConfiguredBindMode({
    deploymentMode: value.server.deploymentMode,
    deploymentExposure: value.server.exposure,
    bind: value.server.bind,
    host: value.server.host,
    customBindHost: value.server.customBindHost
  })) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      message,
      path: message.includes("customBindHost") ? ["server", "customBindHost"] : ["server", "bind"]
    });
  }
  if (value.auth.baseUrlMode === "explicit" && !value.auth.publicBaseUrl) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      message: "auth.publicBaseUrl is required when auth.baseUrlMode is explicit",
      path: ["auth", "publicBaseUrl"]
    });
  }
  if (value.server.exposure === "public" && value.auth.baseUrlMode !== "explicit") {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      message: "auth.baseUrlMode must be explicit when deploymentMode=authenticated and exposure=public",
      path: ["auth", "baseUrlMode"]
    });
  }
  if (value.server.exposure === "public" && !value.auth.publicBaseUrl) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      message: "auth.publicBaseUrl is required when deploymentMode=authenticated and exposure=public",
      path: ["auth", "publicBaseUrl"]
    });
  }
});

// ../../node_modules/.pnpm/@paperclipai+shared@2026.722.0/node_modules/@paperclipai/shared/dist/validators/adapter-registry.js
var adapterRegistryEntrySchema = external_exports.object({
  adapterType: external_exports.string().min(1),
  enabled: external_exports.boolean().default(true),
  runtimeImage: external_exports.string().optional(),
  envKeys: external_exports.array(external_exports.string()).optional(),
  allowFqdns: external_exports.array(external_exports.string()).optional(),
  probeCommand: external_exports.array(external_exports.string()).optional(),
  defaultEnv: external_exports.record(external_exports.string()).optional()
}).strict();
var adapterRegistrySchema = external_exports.array(adapterRegistryEntrySchema);

// ../../node_modules/.pnpm/@paperclipai+plugin-sdk@2026.722.0_react@19.2.8/node_modules/@paperclipai/plugin-sdk/dist/worker-rpc-host.js
import fs from "node:fs";
import { AsyncLocalStorage } from "node:async_hooks";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

// ../../node_modules/.pnpm/@paperclipai+plugin-sdk@2026.722.0_react@19.2.8/node_modules/@paperclipai/plugin-sdk/dist/protocol.js
var JSONRPC_VERSION = "2.0";
var JSONRPC_ERROR_CODES = {
  /** Invalid JSON was received by the server. */
  PARSE_ERROR: -32700,
  /** The JSON sent is not a valid Request object. */
  INVALID_REQUEST: -32600,
  /** The method does not exist or is not available. */
  METHOD_NOT_FOUND: -32601,
  /** Invalid method parameter(s). */
  INVALID_PARAMS: -32602,
  /** Internal JSON-RPC error. */
  INTERNAL_ERROR: -32603
};
var PLUGIN_RPC_ERROR_CODES = {
  /** The worker process is not running or not reachable. */
  WORKER_UNAVAILABLE: -32e3,
  /** The plugin does not have the required capability for this operation. */
  CAPABILITY_DENIED: -32001,
  /** The worker reported an unhandled error during method execution. */
  WORKER_ERROR: -32002,
  /** The method call timed out waiting for the worker response. */
  TIMEOUT: -32003,
  /** The worker does not implement the requested optional method. */
  METHOD_NOT_IMPLEMENTED: -32004,
  /** The worker→host call attempted to escape the current invocation company scope. */
  INVOCATION_SCOPE_DENIED: -32005,
  /** A catch-all for errors that do not fit other categories. */
  UNKNOWN: -32099
};
var _nextId = 1;
var MAX_SAFE_RPC_ID = Number.MAX_SAFE_INTEGER - 1;
function createRequest(method, params, id) {
  if (_nextId >= MAX_SAFE_RPC_ID) {
    _nextId = 1;
  }
  return {
    jsonrpc: JSONRPC_VERSION,
    id: id ?? _nextId++,
    method,
    params
  };
}
function createSuccessResponse(id, result) {
  return {
    jsonrpc: JSONRPC_VERSION,
    id,
    result
  };
}
function createErrorResponse(id, code, message, data) {
  const response = {
    jsonrpc: JSONRPC_VERSION,
    id,
    error: data !== void 0 ? { code, message, data } : { code, message }
  };
  return response;
}
function createNotification(method, params) {
  return {
    jsonrpc: JSONRPC_VERSION,
    method,
    params
  };
}
function isJsonRpcRequest(value) {
  if (typeof value !== "object" || value === null)
    return false;
  const obj = value;
  return obj.jsonrpc === JSONRPC_VERSION && typeof obj.method === "string" && "id" in obj && obj.id !== void 0 && obj.id !== null;
}
function isJsonRpcNotification(value) {
  if (typeof value !== "object" || value === null)
    return false;
  const obj = value;
  return obj.jsonrpc === JSONRPC_VERSION && typeof obj.method === "string" && !("id" in obj);
}
function isJsonRpcResponse(value) {
  if (typeof value !== "object" || value === null)
    return false;
  const obj = value;
  return obj.jsonrpc === JSONRPC_VERSION && "id" in obj && ("result" in obj || "error" in obj);
}
function isJsonRpcSuccessResponse(response) {
  return "result" in response && !("error" in response && response.error !== void 0);
}
function isJsonRpcErrorResponse(response) {
  return "error" in response && response.error !== void 0;
}
var MESSAGE_DELIMITER = "\n";
function serializeMessage(message) {
  return JSON.stringify(message) + MESSAGE_DELIMITER;
}
function parseMessage(line) {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    throw new JsonRpcParseError("Empty message");
  }
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new JsonRpcParseError(`Invalid JSON: ${trimmed.slice(0, 200)}`);
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new JsonRpcParseError("Message must be a JSON object");
  }
  const obj = parsed;
  if (obj.jsonrpc !== JSONRPC_VERSION) {
    throw new JsonRpcParseError(`Invalid or missing jsonrpc version (expected "${JSONRPC_VERSION}", got ${JSON.stringify(obj.jsonrpc)})`);
  }
  return parsed;
}
var JsonRpcParseError = class extends Error {
  name = "JsonRpcParseError";
  constructor(message) {
    super(message);
  }
};
var JsonRpcCallError = class extends Error {
  name = "JsonRpcCallError";
  /** The JSON-RPC error code. */
  code;
  /** Optional structured error data from the response. */
  data;
  constructor(error) {
    super(error.message);
    this.code = error.code;
    this.data = error.data;
  }
};

// ../../node_modules/.pnpm/@paperclipai+plugin-sdk@2026.722.0_react@19.2.8/node_modules/@paperclipai/plugin-sdk/dist/worker-rpc-host.js
var DEFAULT_RPC_TIMEOUT_MS = 3e4;
function realpathOrResolvedPath(filePath) {
  const resolvedPath = path.resolve(filePath);
  try {
    return fs.realpathSync.native(resolvedPath);
  } catch {
    return resolvedPath;
  }
}
function isWorkerEntrypoint(entry, moduleUrl) {
  const thisFile = realpathOrResolvedPath(fileURLToPath(moduleUrl));
  const entryPath = realpathOrResolvedPath(entry);
  return thisFile === entryPath;
}
function runWorker(plugin2, moduleUrl, options) {
  if (options?.stdin != null && options?.stdout != null) {
    return startWorkerRpcHost({
      plugin: plugin2,
      stdin: options.stdin,
      stdout: options.stdout
    });
  }
  const entry = process.argv[1];
  if (typeof entry !== "string")
    return;
  if (isWorkerEntrypoint(entry, moduleUrl)) {
    startWorkerRpcHost({ plugin: plugin2 });
  }
}
function startWorkerRpcHost(options) {
  const { plugin: plugin2 } = options;
  const stdinStream = options.stdin ?? process.stdin;
  const stdoutStream = options.stdout ?? process.stdout;
  const rpcTimeoutMs = options.rpcTimeoutMs ?? DEFAULT_RPC_TIMEOUT_MS;
  let running = true;
  let initialized = false;
  let manifest = null;
  let currentConfig = {};
  let databaseNamespace = null;
  const invocationContextStorage = new AsyncLocalStorage();
  const eventHandlers = [];
  const jobHandlers = /* @__PURE__ */ new Map();
  const launcherRegistrations = /* @__PURE__ */ new Map();
  const dataHandlers = /* @__PURE__ */ new Map();
  const actionHandlers = /* @__PURE__ */ new Map();
  const toolHandlers = /* @__PURE__ */ new Map();
  const sessionEventCallbacks = /* @__PURE__ */ new Map();
  const pendingRequests = /* @__PURE__ */ new Map();
  let nextOutboundId = 1;
  const MAX_OUTBOUND_ID = Number.MAX_SAFE_INTEGER - 1;
  function sendMessage(message) {
    if (!running)
      return;
    const serialized = serializeMessage(message);
    stdoutStream.write(serialized);
  }
  function callHost(method, params, timeoutMs) {
    return new Promise((resolve, reject) => {
      if (!running) {
        reject(new Error(`Cannot call "${method}" \u2014 worker RPC host is not running`));
        return;
      }
      if (nextOutboundId >= MAX_OUTBOUND_ID) {
        nextOutboundId = 1;
      }
      const id = nextOutboundId++;
      const timeout = timeoutMs ?? rpcTimeoutMs;
      let settled = false;
      const settle = (fn, value) => {
        if (settled)
          return;
        settled = true;
        clearTimeout(timer);
        pendingRequests.delete(id);
        fn(value);
      };
      const timer = setTimeout(() => {
        settle(reject, new JsonRpcCallError({
          code: PLUGIN_RPC_ERROR_CODES.TIMEOUT,
          message: `Worker\u2192host call "${method}" timed out after ${timeout}ms`
        }));
      }, timeout);
      pendingRequests.set(id, {
        resolve: (response) => {
          if (isJsonRpcSuccessResponse(response)) {
            settle(resolve, response.result);
          } else if (isJsonRpcErrorResponse(response)) {
            settle(reject, new JsonRpcCallError(response.error));
          } else {
            settle(reject, new Error(`Unexpected response format for "${method}"`));
          }
        },
        timer
      });
      try {
        const activeInvocation = invocationContextStorage.getStore();
        const request = {
          ...createRequest(method, params, id),
          ...activeInvocation ? { paperclipInvocationId: activeInvocation.id } : {}
        };
        sendMessage(request);
      } catch (err) {
        settle(reject, err instanceof Error ? err : new Error(String(err)));
      }
    });
  }
  function notifyHost(method, params) {
    try {
      const activeInvocation = invocationContextStorage.getStore();
      sendMessage({
        ...createNotification(method, params),
        ...activeInvocation ? { paperclipInvocationId: activeInvocation.id } : {}
      });
    } catch {
    }
  }
  function buildContext() {
    return {
      get manifest() {
        if (!manifest)
          throw new Error("Plugin context accessed before initialization");
        return manifest;
      },
      config: {
        async get(companyId) {
          return callHost("config.get", companyId ? { companyId } : {});
        }
      },
      localFolders: {
        declarations() {
          if (!manifest)
            throw new Error("Plugin context accessed before initialization");
          return manifest.localFolders ?? [];
        },
        async configure(input) {
          return callHost("localFolders.configure", {
            companyId: input.companyId,
            folderKey: input.folderKey,
            path: input.path,
            access: input.access,
            requiredDirectories: input.requiredDirectories,
            requiredFiles: input.requiredFiles
          });
        },
        async status(companyId, folderKey) {
          return callHost("localFolders.status", { companyId, folderKey });
        },
        async list(companyId, folderKey, options2 = {}) {
          return callHost("localFolders.list", {
            companyId,
            folderKey,
            relativePath: options2.relativePath,
            recursive: options2.recursive,
            maxEntries: options2.maxEntries
          });
        },
        async readText(companyId, folderKey, relativePath) {
          return callHost("localFolders.readText", { companyId, folderKey, relativePath });
        },
        async writeTextAtomic(companyId, folderKey, relativePath, contents) {
          return callHost("localFolders.writeTextAtomic", {
            companyId,
            folderKey,
            relativePath,
            contents
          });
        },
        async deleteFile(companyId, folderKey, relativePath) {
          return callHost("localFolders.deleteFile", { companyId, folderKey, relativePath });
        }
      },
      events: {
        on(name, filterOrFn, maybeFn) {
          let registration;
          if (typeof filterOrFn === "function") {
            registration = { name, fn: filterOrFn };
          } else {
            if (!maybeFn)
              throw new Error("Event handler function is required");
            registration = { name, filter: filterOrFn, fn: maybeFn };
          }
          eventHandlers.push(registration);
          void callHost("events.subscribe", { eventPattern: name, filter: registration.filter ?? null }).catch((err) => {
            notifyHost("log", {
              level: "warn",
              message: `Failed to subscribe to event "${name}" on host: ${err instanceof Error ? err.message : String(err)}`
            });
          });
          return () => {
            const idx = eventHandlers.indexOf(registration);
            if (idx !== -1)
              eventHandlers.splice(idx, 1);
          };
        },
        async emit(name, companyId, payload) {
          await callHost("events.emit", { name, companyId, payload });
        }
      },
      jobs: {
        register(key, fn) {
          jobHandlers.set(key, fn);
        }
      },
      launchers: {
        register(launcher) {
          launcherRegistrations.set(launcher.id, launcher);
        }
      },
      db: {
        get namespace() {
          return databaseNamespace ?? "";
        },
        async query(sql, params) {
          return callHost("db.query", { sql, params });
        },
        async execute(sql, params) {
          return callHost("db.execute", { sql, params });
        }
      },
      http: {
        async fetch(url, init) {
          const serializedInit = {};
          if (init) {
            if (init.method)
              serializedInit.method = init.method;
            if (init.headers) {
              if (init.headers instanceof Headers) {
                const obj = {};
                init.headers.forEach((v, k) => {
                  obj[k] = v;
                });
                serializedInit.headers = obj;
              } else if (Array.isArray(init.headers)) {
                const obj = {};
                for (const [k, v] of init.headers)
                  obj[k] = v;
                serializedInit.headers = obj;
              } else {
                serializedInit.headers = init.headers;
              }
            }
            if (init.body !== void 0 && init.body !== null) {
              serializedInit.body = typeof init.body === "string" ? init.body : String(init.body);
            }
          }
          const result = await callHost("http.fetch", {
            url,
            init: Object.keys(serializedInit).length > 0 ? serializedInit : void 0
          });
          return new Response(result.body, {
            status: result.status,
            statusText: result.statusText,
            headers: result.headers
          });
        }
      },
      secrets: {
        async resolve(secretRef, options2 = {}) {
          return callHost("secrets.resolve", {
            secretRef,
            companyId: options2.companyId,
            configPath: options2.configPath
          });
        }
      },
      activity: {
        async log(entry) {
          await callHost("activity.log", {
            companyId: entry.companyId,
            message: entry.message,
            entityType: entry.entityType,
            entityId: entry.entityId,
            metadata: entry.metadata
          });
        }
      },
      state: {
        async get(input) {
          return callHost("state.get", {
            scopeKind: input.scopeKind,
            scopeId: input.scopeId,
            namespace: input.namespace,
            stateKey: input.stateKey
          });
        },
        async set(input, value) {
          await callHost("state.set", {
            scopeKind: input.scopeKind,
            scopeId: input.scopeId,
            namespace: input.namespace,
            stateKey: input.stateKey,
            value
          });
        },
        async delete(input) {
          await callHost("state.delete", {
            scopeKind: input.scopeKind,
            scopeId: input.scopeId,
            namespace: input.namespace,
            stateKey: input.stateKey
          });
        }
      },
      entities: {
        async upsert(input) {
          return callHost("entities.upsert", {
            entityType: input.entityType,
            scopeKind: input.scopeKind,
            scopeId: input.scopeId,
            externalId: input.externalId,
            title: input.title,
            status: input.status,
            data: input.data
          });
        },
        async list(query) {
          return callHost("entities.list", {
            entityType: query.entityType,
            scopeKind: query.scopeKind,
            scopeId: query.scopeId,
            externalId: query.externalId,
            limit: query.limit,
            offset: query.offset
          });
        }
      },
      projects: {
        async list(input) {
          return callHost("projects.list", {
            companyId: input.companyId,
            limit: input.limit,
            offset: input.offset
          });
        },
        async get(projectId, companyId) {
          return callHost("projects.get", { projectId, companyId });
        },
        async listWorkspaces(projectId, companyId) {
          return callHost("projects.listWorkspaces", { projectId, companyId });
        },
        async getPrimaryWorkspace(projectId, companyId) {
          return callHost("projects.getPrimaryWorkspace", { projectId, companyId });
        },
        async getWorkspaceForIssue(issueId, companyId) {
          return callHost("projects.getWorkspaceForIssue", { issueId, companyId });
        },
        managed: {
          async get(projectKey, companyId) {
            return callHost("projects.managed.get", { projectKey, companyId });
          },
          async reconcile(projectKey, companyId) {
            return callHost("projects.managed.reconcile", { projectKey, companyId });
          },
          async reset(projectKey, companyId) {
            return callHost("projects.managed.reset", { projectKey, companyId });
          }
        }
      },
      executionWorkspaces: {
        async get(workspaceId, companyId) {
          return callHost("executionWorkspaces.get", { workspaceId, companyId });
        }
      },
      routines: {
        managed: {
          async get(routineKey, companyId) {
            return callHost("routines.managed.get", { routineKey, companyId });
          },
          async reconcile(routineKey, companyId, overrides) {
            return callHost("routines.managed.reconcile", { routineKey, companyId, ...overrides });
          },
          async reset(routineKey, companyId, overrides) {
            return callHost("routines.managed.reset", { routineKey, companyId, ...overrides });
          },
          async update(routineKey, companyId, patch) {
            return callHost("routines.managed.update", { routineKey, companyId, ...patch });
          },
          async run(routineKey, companyId, overrides) {
            return callHost("routines.managed.run", { routineKey, companyId, ...overrides });
          }
        }
      },
      skills: {
        managed: {
          async get(skillKey, companyId) {
            return callHost("skills.managed.get", { skillKey, companyId });
          },
          async reconcile(skillKey, companyId) {
            return callHost("skills.managed.reconcile", { skillKey, companyId });
          },
          async reset(skillKey, companyId) {
            return callHost("skills.managed.reset", { skillKey, companyId });
          }
        }
      },
      companies: {
        async list(input) {
          return callHost("companies.list", {
            limit: input?.limit,
            offset: input?.offset
          });
        },
        async get(companyId) {
          return callHost("companies.get", { companyId });
        }
      },
      issues: {
        async list(input) {
          return callHost("issues.list", {
            companyId: input.companyId,
            projectId: input.projectId,
            assigneeAgentId: input.assigneeAgentId,
            originKind: input.originKind,
            originKindPrefix: input.originKindPrefix,
            originId: input.originId,
            status: input.status,
            includePluginOperations: input.includePluginOperations,
            limit: input.limit,
            offset: input.offset
          });
        },
        async get(issueId, companyId) {
          return callHost("issues.get", { issueId, companyId });
        },
        async create(input) {
          return callHost("issues.create", {
            companyId: input.companyId,
            projectId: input.projectId,
            goalId: input.goalId,
            parentId: input.parentId,
            inheritExecutionWorkspaceFromIssueId: input.inheritExecutionWorkspaceFromIssueId,
            title: input.title,
            description: input.description,
            status: input.status,
            priority: input.priority,
            assigneeAgentId: input.assigneeAgentId,
            assigneeUserId: input.assigneeUserId,
            requestDepth: input.requestDepth,
            billingCode: input.billingCode,
            assigneeAdapterOverrides: input.assigneeAdapterOverrides,
            surfaceVisibility: input.surfaceVisibility,
            originKind: input.originKind,
            originId: input.originId,
            originRunId: input.originRunId,
            blockedByIssueIds: input.blockedByIssueIds,
            labelIds: input.labelIds,
            executionWorkspaceId: input.executionWorkspaceId,
            executionWorkspacePreference: input.executionWorkspacePreference,
            executionWorkspaceSettings: input.executionWorkspaceSettings,
            actorAgentId: input.actor?.actorAgentId,
            actorUserId: input.actor?.actorUserId,
            actorRunId: input.actor?.actorRunId
          });
        },
        async update(issueId, patch, companyId, actor) {
          return callHost("issues.update", {
            issueId,
            patch: {
              ...patch,
              actorAgentId: actor?.actorAgentId,
              actorUserId: actor?.actorUserId,
              actorRunId: actor?.actorRunId
            },
            companyId
          });
        },
        async assertCheckoutOwner(input) {
          return callHost("issues.assertCheckoutOwner", input);
        },
        async getSubtree(issueId, companyId, options2) {
          return callHost("issues.getSubtree", {
            issueId,
            companyId,
            includeRoot: options2?.includeRoot,
            includeRelations: options2?.includeRelations,
            includeDocuments: options2?.includeDocuments,
            includeActiveRuns: options2?.includeActiveRuns,
            includeAssignees: options2?.includeAssignees
          });
        },
        async requestWakeup(issueId, companyId, options2) {
          return callHost("issues.requestWakeup", {
            issueId,
            companyId,
            reason: options2?.reason,
            contextSource: options2?.contextSource,
            idempotencyKey: options2?.idempotencyKey,
            actorAgentId: options2?.actorAgentId,
            actorUserId: options2?.actorUserId,
            actorRunId: options2?.actorRunId
          });
        },
        async requestWakeups(issueIds, companyId, options2) {
          return callHost("issues.requestWakeups", {
            issueIds,
            companyId,
            reason: options2?.reason,
            contextSource: options2?.contextSource,
            idempotencyKeyPrefix: options2?.idempotencyKeyPrefix,
            actorAgentId: options2?.actorAgentId,
            actorUserId: options2?.actorUserId,
            actorRunId: options2?.actorRunId
          });
        },
        async listComments(issueId, companyId) {
          return callHost("issues.listComments", { issueId, companyId });
        },
        async createComment(issueId, body, companyId, options2) {
          return callHost("issues.createComment", {
            issueId,
            body,
            companyId,
            authorAgentId: options2?.authorAgentId,
            actorUserId: options2?.actorUserId
          });
        },
        async createInteraction(issueId, interaction, companyId, options2) {
          return callHost("issues.createInteraction", {
            issueId,
            companyId,
            interaction,
            authorAgentId: options2?.authorAgentId
          });
        },
        async suggestTasks(issueId, interaction, companyId, options2) {
          return callHost("issues.createInteraction", {
            issueId,
            companyId,
            interaction: {
              ...interaction,
              kind: "suggest_tasks"
            },
            authorAgentId: options2?.authorAgentId
          });
        },
        async askUserQuestions(issueId, interaction, companyId, options2) {
          return callHost("issues.createInteraction", {
            issueId,
            companyId,
            interaction: {
              ...interaction,
              kind: "ask_user_questions"
            },
            authorAgentId: options2?.authorAgentId
          });
        },
        async requestConfirmation(issueId, interaction, companyId, options2) {
          return callHost("issues.createInteraction", {
            issueId,
            companyId,
            interaction: {
              ...interaction,
              kind: "request_confirmation"
            },
            authorAgentId: options2?.authorAgentId
          });
        },
        async requestCheckboxConfirmation(issueId, interaction, companyId, options2) {
          return callHost("issues.createInteraction", {
            issueId,
            companyId,
            interaction: {
              ...interaction,
              kind: "request_checkbox_confirmation"
            },
            authorAgentId: options2?.authorAgentId
          });
        },
        documents: {
          async list(issueId, companyId) {
            return callHost("issues.documents.list", { issueId, companyId });
          },
          async get(issueId, key, companyId) {
            return callHost("issues.documents.get", { issueId, key, companyId });
          },
          async upsert(input) {
            return callHost("issues.documents.upsert", {
              issueId: input.issueId,
              key: input.key,
              body: input.body,
              companyId: input.companyId,
              title: input.title,
              format: input.format,
              changeSummary: input.changeSummary
            });
          },
          async delete(issueId, key, companyId) {
            return callHost("issues.documents.delete", { issueId, key, companyId });
          }
        },
        relations: {
          async get(issueId, companyId) {
            return callHost("issues.relations.get", { issueId, companyId });
          },
          async setBlockedBy(issueId, blockedByIssueIds, companyId, actor) {
            return callHost("issues.relations.setBlockedBy", {
              issueId,
              companyId,
              blockedByIssueIds,
              actorAgentId: actor?.actorAgentId,
              actorUserId: actor?.actorUserId,
              actorRunId: actor?.actorRunId
            });
          },
          async addBlockers(issueId, blockerIssueIds, companyId, actor) {
            return callHost("issues.relations.addBlockers", {
              issueId,
              companyId,
              blockerIssueIds,
              actorAgentId: actor?.actorAgentId,
              actorUserId: actor?.actorUserId,
              actorRunId: actor?.actorRunId
            });
          },
          async removeBlockers(issueId, blockerIssueIds, companyId, actor) {
            return callHost("issues.relations.removeBlockers", {
              issueId,
              companyId,
              blockerIssueIds,
              actorAgentId: actor?.actorAgentId,
              actorUserId: actor?.actorUserId,
              actorRunId: actor?.actorRunId
            });
          }
        },
        summaries: {
          async getOrchestration(input) {
            return callHost("issues.summaries.getOrchestration", input);
          }
        }
      },
      agents: {
        async list(input) {
          return callHost("agents.list", {
            companyId: input.companyId,
            status: input.status,
            limit: input.limit,
            offset: input.offset
          });
        },
        async get(agentId, companyId) {
          return callHost("agents.get", { agentId, companyId });
        },
        async pause(agentId, companyId) {
          return callHost("agents.pause", { agentId, companyId });
        },
        async resume(agentId, companyId) {
          return callHost("agents.resume", { agentId, companyId });
        },
        async invoke(agentId, companyId, opts) {
          return callHost("agents.invoke", { agentId, companyId, prompt: opts.prompt, reason: opts.reason });
        },
        managed: {
          async get(agentKey, companyId) {
            return callHost("agents.managed.get", { agentKey, companyId });
          },
          async reconcile(agentKey, companyId) {
            return callHost("agents.managed.reconcile", { agentKey, companyId });
          },
          async reset(agentKey, companyId) {
            return callHost("agents.managed.reset", { agentKey, companyId });
          }
        },
        sessions: {
          async create(agentId, companyId, opts) {
            return callHost("agents.sessions.create", {
              agentId,
              companyId,
              taskKey: opts?.taskKey,
              reason: opts?.reason
            });
          },
          async list(agentId, companyId) {
            return callHost("agents.sessions.list", { agentId, companyId });
          },
          async sendMessage(sessionId, companyId, opts) {
            if (opts.onEvent) {
              sessionEventCallbacks.set(sessionId, opts.onEvent);
            }
            try {
              return await callHost("agents.sessions.sendMessage", {
                sessionId,
                companyId,
                prompt: opts.prompt,
                reason: opts.reason
              });
            } catch (err) {
              sessionEventCallbacks.delete(sessionId);
              throw err;
            }
          },
          async close(sessionId, companyId) {
            sessionEventCallbacks.delete(sessionId);
            await callHost("agents.sessions.close", { sessionId, companyId });
          }
        }
      },
      goals: {
        async list(input) {
          return callHost("goals.list", {
            companyId: input.companyId,
            level: input.level,
            status: input.status,
            limit: input.limit,
            offset: input.offset
          });
        },
        async get(goalId, companyId) {
          return callHost("goals.get", { goalId, companyId });
        },
        async create(input) {
          return callHost("goals.create", {
            companyId: input.companyId,
            title: input.title,
            description: input.description,
            level: input.level,
            status: input.status,
            parentId: input.parentId,
            ownerAgentId: input.ownerAgentId
          });
        },
        async update(goalId, patch, companyId) {
          return callHost("goals.update", {
            goalId,
            patch,
            companyId
          });
        }
      },
      access: {
        members: {
          async list(input) {
            return callHost("access.members.list", {
              companyId: input.companyId,
              includeArchived: input.includeArchived
            });
          },
          async get(memberId, companyId) {
            return callHost("access.members.get", { memberId, companyId });
          },
          async update(memberId, patch, companyId) {
            return callHost("access.members.update", { memberId, patch, companyId });
          }
        },
        invites: {
          async list(input) {
            return callHost("access.invites.list", {
              companyId: input.companyId,
              state: input.state,
              limit: input.limit,
              offset: input.offset
            });
          },
          async create(input) {
            return callHost("access.invites.create", {
              companyId: input.companyId,
              allowedJoinTypes: input.allowedJoinTypes,
              humanRole: input.humanRole,
              defaultsPayload: input.defaultsPayload,
              agentMessage: input.agentMessage
            });
          },
          async revoke(inviteId, companyId) {
            return callHost("access.invites.revoke", { inviteId, companyId });
          }
        }
      },
      authorization: {
        grants: {
          async list(input) {
            return callHost("authorization.grants.list", input);
          },
          async set(input) {
            return callHost("authorization.grants.set", input);
          }
        },
        policies: {
          async summary(companyId) {
            return callHost("authorization.policies.summary", { companyId });
          },
          async get(input) {
            return callHost("authorization.policies.get", input);
          },
          async update(input) {
            return callHost("authorization.policies.update", input);
          },
          async previewAssignment(input) {
            return callHost("authorization.policies.previewAssignment", input);
          },
          async explainAssignment(input) {
            return callHost("authorization.policies.explainAssignment", input);
          }
        },
        audit: {
          async search(input) {
            return callHost("authorization.audit.search", input);
          }
        }
      },
      data: {
        register(key, handler) {
          dataHandlers.set(key, handler);
        }
      },
      actions: {
        register(key, handler) {
          actionHandlers.set(key, handler);
        }
      },
      streams: /* @__PURE__ */ (() => {
        const channelCompanyMap = /* @__PURE__ */ new Map();
        return {
          open(channel, companyId) {
            channelCompanyMap.set(channel, companyId);
            notifyHost("streams.open", { channel, companyId });
          },
          emit(channel, event) {
            const companyId = channelCompanyMap.get(channel) ?? "";
            notifyHost("streams.emit", { channel, companyId, event });
          },
          close(channel) {
            const companyId = channelCompanyMap.get(channel) ?? "";
            channelCompanyMap.delete(channel);
            notifyHost("streams.close", { channel, companyId });
          }
        };
      })(),
      tools: {
        register(name, declaration, fn) {
          toolHandlers.set(name, { declaration, fn });
        }
      },
      metrics: {
        async write(name, value, tags) {
          await callHost("metrics.write", { name, value, tags });
        }
      },
      telemetry: {
        async track(eventName, dimensions) {
          await callHost("telemetry.track", { eventName, dimensions });
        }
      },
      logger: {
        info(message, meta) {
          notifyHost("log", { level: "info", message, meta });
        },
        warn(message, meta) {
          notifyHost("log", { level: "warn", message, meta });
        },
        error(message, meta) {
          notifyHost("log", { level: "error", message, meta });
        },
        debug(message, meta) {
          notifyHost("log", { level: "debug", message, meta });
        }
      }
    };
  }
  const ctx = buildContext();
  async function handleHostRequest(request) {
    const { id, method, params } = request;
    try {
      const invoke = () => dispatchMethod(method, params);
      const result = request.paperclipInvocation ? await invocationContextStorage.run(request.paperclipInvocation, invoke) : await invoke();
      sendMessage(createSuccessResponse(id, result ?? null));
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const errorCode = typeof err?.code === "number" ? err.code : PLUGIN_RPC_ERROR_CODES.WORKER_ERROR;
      sendMessage(createErrorResponse(id, errorCode, errorMessage));
    }
  }
  async function dispatchMethod(method, params) {
    switch (method) {
      case "initialize":
        return handleInitialize(params);
      case "health":
        return handleHealth();
      case "shutdown":
        return handleShutdown();
      case "validateConfig":
        return handleValidateConfig(params);
      case "configChanged":
        return handleConfigChanged(params);
      case "onEvent":
        return handleOnEvent(params);
      case "runJob":
        return handleRunJob(params);
      case "handleWebhook":
        return handleWebhook(params);
      case "handleApiRequest":
        return handleApiRequest(params);
      case "getData":
        return handleGetData(params);
      case "performAction":
        return handlePerformAction(params);
      case "executeTool":
        return handleExecuteTool(params);
      case "detectExternalObjects":
        return handleDetectExternalObjects(params);
      case "resolveExternalObject":
        return handleResolveExternalObject(params);
      case "refreshExternalObjects":
        return handleRefreshExternalObjects(params);
      case "environmentValidateConfig":
        return handleEnvironmentValidateConfig(params);
      case "environmentProbe":
        return handleEnvironmentProbe(params);
      case "environmentAcquireLease":
        return handleEnvironmentAcquireLease(params);
      case "environmentResumeLease":
        return handleEnvironmentResumeLease(params);
      case "environmentReleaseLease":
        return handleEnvironmentReleaseLease(params);
      case "environmentDestroyLease":
        return handleEnvironmentDestroyLease(params);
      case "environmentRealizeWorkspace":
        return handleEnvironmentRealizeWorkspace(params);
      case "environmentExecute":
        return handleEnvironmentExecute(params);
      case "environmentSyncIn":
        return handleEnvironmentSyncIn(params);
      case "environmentSyncOut":
        return handleEnvironmentSyncOut(params);
      case "environmentStartInteractiveSetup":
        return handleEnvironmentStartInteractiveSetup(params);
      case "environmentGetInteractiveSetup":
        return handleEnvironmentGetInteractiveSetup(params);
      case "environmentCaptureTemplate":
        return handleEnvironmentCaptureTemplate(params);
      case "environmentCancelInteractiveSetup":
        return handleEnvironmentCancelInteractiveSetup(params);
      case "environmentDeleteTemplate":
        return handleEnvironmentDeleteTemplate(params);
      default:
        throw Object.assign(new Error(`Unknown method: ${method}`), { code: JSONRPC_ERROR_CODES.METHOD_NOT_FOUND });
    }
  }
  async function handleInitialize(params) {
    if (initialized) {
      throw new Error("Worker already initialized");
    }
    manifest = params.manifest;
    currentConfig = params.config;
    databaseNamespace = params.databaseNamespace ?? null;
    await plugin2.definition.setup(ctx);
    initialized = true;
    const supportedMethods = [];
    if (plugin2.definition.onValidateConfig)
      supportedMethods.push("validateConfig");
    if (plugin2.definition.onConfigChanged)
      supportedMethods.push("configChanged");
    if (plugin2.definition.onHealth)
      supportedMethods.push("health");
    if (plugin2.definition.onShutdown)
      supportedMethods.push("shutdown");
    if (plugin2.definition.onApiRequest)
      supportedMethods.push("handleApiRequest");
    if (plugin2.definition.onDetectExternalObjects)
      supportedMethods.push("detectExternalObjects");
    if (plugin2.definition.onResolveExternalObject)
      supportedMethods.push("resolveExternalObject");
    if (plugin2.definition.onRefreshExternalObjects)
      supportedMethods.push("refreshExternalObjects");
    if (plugin2.definition.onEnvironmentValidateConfig)
      supportedMethods.push("environmentValidateConfig");
    if (plugin2.definition.onEnvironmentProbe)
      supportedMethods.push("environmentProbe");
    if (plugin2.definition.onEnvironmentAcquireLease)
      supportedMethods.push("environmentAcquireLease");
    if (plugin2.definition.onEnvironmentResumeLease)
      supportedMethods.push("environmentResumeLease");
    if (plugin2.definition.onEnvironmentReleaseLease)
      supportedMethods.push("environmentReleaseLease");
    if (plugin2.definition.onEnvironmentDestroyLease)
      supportedMethods.push("environmentDestroyLease");
    if (plugin2.definition.onEnvironmentRealizeWorkspace)
      supportedMethods.push("environmentRealizeWorkspace");
    if (plugin2.definition.onEnvironmentExecute)
      supportedMethods.push("environmentExecute");
    if (plugin2.definition.onEnvironmentSyncIn)
      supportedMethods.push("environmentSyncIn");
    if (plugin2.definition.onEnvironmentSyncOut)
      supportedMethods.push("environmentSyncOut");
    if (plugin2.definition.onEnvironmentStartInteractiveSetup)
      supportedMethods.push("environmentStartInteractiveSetup");
    if (plugin2.definition.onEnvironmentGetInteractiveSetup)
      supportedMethods.push("environmentGetInteractiveSetup");
    if (plugin2.definition.onEnvironmentCaptureTemplate)
      supportedMethods.push("environmentCaptureTemplate");
    if (plugin2.definition.onEnvironmentCancelInteractiveSetup)
      supportedMethods.push("environmentCancelInteractiveSetup");
    if (plugin2.definition.onEnvironmentDeleteTemplate)
      supportedMethods.push("environmentDeleteTemplate");
    return { ok: true, supportedMethods };
  }
  async function handleHealth() {
    if (plugin2.definition.onHealth) {
      return plugin2.definition.onHealth();
    }
    return { status: "ok" };
  }
  async function handleShutdown() {
    if (plugin2.definition.onShutdown) {
      await plugin2.definition.onShutdown();
    }
    setImmediate(() => {
      cleanup();
      if (!options.stdin && !options.stdout) {
        process.exit(0);
      }
    });
  }
  async function handleValidateConfig(params) {
    if (!plugin2.definition.onValidateConfig) {
      throw Object.assign(new Error("validateConfig is not implemented by this plugin"), { code: PLUGIN_RPC_ERROR_CODES.METHOD_NOT_IMPLEMENTED });
    }
    return plugin2.definition.onValidateConfig(params.config);
  }
  async function handleConfigChanged(params) {
    currentConfig = params.config;
    if (plugin2.definition.onConfigChanged) {
      await plugin2.definition.onConfigChanged(params.config);
    }
  }
  async function handleOnEvent(params) {
    const event = params.event;
    for (const registration of eventHandlers) {
      const exactMatch = registration.name === event.eventType;
      const wildcardPluginAll = registration.name === "plugin.*" && event.eventType.startsWith("plugin.");
      const wildcardPluginOne = registration.name.endsWith(".*") && event.eventType.startsWith(registration.name.slice(0, -1));
      if (!exactMatch && !wildcardPluginAll && !wildcardPluginOne)
        continue;
      if (registration.filter && !allowsEvent(registration.filter, event))
        continue;
      try {
        await registration.fn(event);
      } catch (err) {
        notifyHost("log", {
          level: "error",
          message: `Event handler for "${registration.name}" failed: ${err instanceof Error ? err.message : String(err)}`,
          meta: { eventType: event.eventType, stack: err instanceof Error ? err.stack : void 0 }
        });
      }
    }
  }
  async function handleRunJob(params) {
    const handler = jobHandlers.get(params.job.jobKey);
    if (!handler) {
      throw new Error(`No handler registered for job "${params.job.jobKey}"`);
    }
    await handler(params.job);
  }
  async function handleWebhook(params) {
    if (!plugin2.definition.onWebhook) {
      throw Object.assign(new Error("handleWebhook is not implemented by this plugin"), { code: PLUGIN_RPC_ERROR_CODES.METHOD_NOT_IMPLEMENTED });
    }
    await plugin2.definition.onWebhook(params);
  }
  async function handleApiRequest(params) {
    if (!plugin2.definition.onApiRequest) {
      throw Object.assign(new Error("handleApiRequest is not implemented by this plugin"), { code: PLUGIN_RPC_ERROR_CODES.METHOD_NOT_IMPLEMENTED });
    }
    return plugin2.definition.onApiRequest(params);
  }
  async function handleGetData(params) {
    const handler = dataHandlers.get(params.key);
    if (!handler) {
      throw new Error(`No data handler registered for key "${params.key}"`);
    }
    return handler({
      ...params.params,
      ...params.companyId === void 0 ? {} : { companyId: params.companyId },
      ...params.renderEnvironment === void 0 ? {} : { renderEnvironment: params.renderEnvironment }
    });
  }
  function stringOrNull(value) {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  }
  function actorTypeOrSystem(value) {
    return value === "user" || value === "agent" || value === "system" ? value : "system";
  }
  function actionContextFromParams(params) {
    const rawActor = params.actorContext && typeof params.actorContext === "object" ? params.actorContext : null;
    const actor = Object.freeze({
      type: actorTypeOrSystem(rawActor?.type),
      userId: stringOrNull(rawActor?.userId),
      agentId: stringOrNull(rawActor?.agentId),
      runId: stringOrNull(rawActor?.runId),
      companyId: stringOrNull(rawActor?.companyId)
    });
    return Object.freeze({
      actor,
      companyId: actor.companyId
    });
  }
  async function handlePerformAction(params) {
    const handler = actionHandlers.get(params.key);
    if (!handler) {
      throw new Error(`No action handler registered for key "${params.key}"`);
    }
    return handler({
      ...params.params,
      ...params.companyId === void 0 ? {} : { companyId: params.companyId },
      ...params.renderEnvironment === void 0 ? {} : { renderEnvironment: params.renderEnvironment }
    }, actionContextFromParams(params));
  }
  async function handleExecuteTool(params) {
    const entry = toolHandlers.get(params.toolName);
    if (!entry) {
      throw new Error(`No tool handler registered for "${params.toolName}"`);
    }
    return entry.fn(params.parameters, params.runContext);
  }
  async function handleDetectExternalObjects(params) {
    if (!plugin2.definition.onDetectExternalObjects) {
      throw methodNotImplemented("detectExternalObjects");
    }
    return plugin2.definition.onDetectExternalObjects(params);
  }
  async function handleResolveExternalObject(params) {
    if (!plugin2.definition.onResolveExternalObject) {
      throw methodNotImplemented("resolveExternalObject");
    }
    return plugin2.definition.onResolveExternalObject(params);
  }
  async function handleRefreshExternalObjects(params) {
    if (!plugin2.definition.onRefreshExternalObjects) {
      throw methodNotImplemented("refreshExternalObjects");
    }
    return plugin2.definition.onRefreshExternalObjects(params);
  }
  function methodNotImplemented(method) {
    return Object.assign(new Error(`${method} is not implemented by this plugin`), { code: PLUGIN_RPC_ERROR_CODES.METHOD_NOT_IMPLEMENTED });
  }
  async function handleEnvironmentValidateConfig(params) {
    if (!plugin2.definition.onEnvironmentValidateConfig) {
      throw methodNotImplemented("environmentValidateConfig");
    }
    return plugin2.definition.onEnvironmentValidateConfig(params);
  }
  async function handleEnvironmentProbe(params) {
    if (!plugin2.definition.onEnvironmentProbe) {
      throw methodNotImplemented("environmentProbe");
    }
    return plugin2.definition.onEnvironmentProbe(params);
  }
  async function handleEnvironmentAcquireLease(params) {
    if (!plugin2.definition.onEnvironmentAcquireLease) {
      throw methodNotImplemented("environmentAcquireLease");
    }
    return plugin2.definition.onEnvironmentAcquireLease(params);
  }
  async function handleEnvironmentResumeLease(params) {
    if (!plugin2.definition.onEnvironmentResumeLease) {
      throw methodNotImplemented("environmentResumeLease");
    }
    return plugin2.definition.onEnvironmentResumeLease(params);
  }
  async function handleEnvironmentReleaseLease(params) {
    if (!plugin2.definition.onEnvironmentReleaseLease) {
      throw methodNotImplemented("environmentReleaseLease");
    }
    return plugin2.definition.onEnvironmentReleaseLease(params);
  }
  async function handleEnvironmentDestroyLease(params) {
    if (!plugin2.definition.onEnvironmentDestroyLease) {
      throw methodNotImplemented("environmentDestroyLease");
    }
    return plugin2.definition.onEnvironmentDestroyLease(params);
  }
  async function handleEnvironmentRealizeWorkspace(params) {
    if (!plugin2.definition.onEnvironmentRealizeWorkspace) {
      throw methodNotImplemented("environmentRealizeWorkspace");
    }
    return plugin2.definition.onEnvironmentRealizeWorkspace(params);
  }
  async function handleEnvironmentExecute(params) {
    if (!plugin2.definition.onEnvironmentExecute) {
      throw methodNotImplemented("environmentExecute");
    }
    return plugin2.definition.onEnvironmentExecute(params);
  }
  async function handleEnvironmentSyncIn(params) {
    if (!plugin2.definition.onEnvironmentSyncIn) {
      throw methodNotImplemented("environmentSyncIn");
    }
    return plugin2.definition.onEnvironmentSyncIn(params);
  }
  async function handleEnvironmentSyncOut(params) {
    if (!plugin2.definition.onEnvironmentSyncOut) {
      throw methodNotImplemented("environmentSyncOut");
    }
    return plugin2.definition.onEnvironmentSyncOut(params);
  }
  async function handleEnvironmentStartInteractiveSetup(params) {
    if (!plugin2.definition.onEnvironmentStartInteractiveSetup) {
      throw methodNotImplemented("environmentStartInteractiveSetup");
    }
    return plugin2.definition.onEnvironmentStartInteractiveSetup(params);
  }
  async function handleEnvironmentGetInteractiveSetup(params) {
    if (!plugin2.definition.onEnvironmentGetInteractiveSetup) {
      throw methodNotImplemented("environmentGetInteractiveSetup");
    }
    return plugin2.definition.onEnvironmentGetInteractiveSetup(params);
  }
  async function handleEnvironmentCaptureTemplate(params) {
    if (!plugin2.definition.onEnvironmentCaptureTemplate) {
      throw methodNotImplemented("environmentCaptureTemplate");
    }
    return plugin2.definition.onEnvironmentCaptureTemplate(params);
  }
  async function handleEnvironmentCancelInteractiveSetup(params) {
    if (!plugin2.definition.onEnvironmentCancelInteractiveSetup) {
      throw methodNotImplemented("environmentCancelInteractiveSetup");
    }
    return plugin2.definition.onEnvironmentCancelInteractiveSetup(params);
  }
  async function handleEnvironmentDeleteTemplate(params) {
    if (!plugin2.definition.onEnvironmentDeleteTemplate) {
      throw methodNotImplemented("environmentDeleteTemplate");
    }
    return plugin2.definition.onEnvironmentDeleteTemplate(params);
  }
  function allowsEvent(filter, event) {
    const payload = event.payload;
    if (filter.companyId !== void 0) {
      const companyId = event.companyId ?? String(payload?.companyId ?? "");
      if (companyId !== filter.companyId)
        return false;
    }
    if (filter.projectId !== void 0) {
      const projectId = event.entityType === "project" ? event.entityId : String(payload?.projectId ?? "");
      if (projectId !== filter.projectId)
        return false;
    }
    if (filter.agentId !== void 0) {
      const agentId = event.entityType === "agent" ? event.entityId : String(payload?.agentId ?? "");
      if (agentId !== filter.agentId)
        return false;
    }
    return true;
  }
  function handleHostResponse(response) {
    const id = response.id;
    if (id === null || id === void 0)
      return;
    const pending = pendingRequests.get(id);
    if (!pending)
      return;
    clearTimeout(pending.timer);
    pendingRequests.delete(id);
    pending.resolve(response);
  }
  function handleLine(line) {
    if (!line.trim())
      return;
    let message;
    try {
      message = parseMessage(line);
    } catch (err) {
      if (err instanceof JsonRpcParseError) {
        sendMessage(createErrorResponse(null, JSONRPC_ERROR_CODES.PARSE_ERROR, `Parse error: ${err.message}`));
      }
      return;
    }
    if (isJsonRpcResponse(message)) {
      handleHostResponse(message);
    } else if (isJsonRpcRequest(message)) {
      handleHostRequest(message).catch((err) => {
        const errorMessage = err instanceof Error ? err.message : String(err);
        const errorCode = err?.code ?? PLUGIN_RPC_ERROR_CODES.WORKER_ERROR;
        try {
          sendMessage(createErrorResponse(message.id, typeof errorCode === "number" ? errorCode : PLUGIN_RPC_ERROR_CODES.WORKER_ERROR, errorMessage));
        } catch {
        }
      });
    } else if (isJsonRpcNotification(message)) {
      const notif = message;
      const runNotification = (fn) => {
        if (notif.paperclipInvocation) {
          return invocationContextStorage.run(notif.paperclipInvocation, fn);
        }
        return fn();
      };
      if (notif.method === "agents.sessions.event" && notif.params) {
        const event = notif.params;
        const cb = sessionEventCallbacks.get(event.sessionId);
        if (cb)
          cb(event);
      } else if (notif.method === "onEvent" && notif.params) {
        Promise.resolve(runNotification(() => handleOnEvent(notif.params))).catch((err) => {
          notifyHost("log", {
            level: "error",
            message: `Failed to handle event notification: ${err instanceof Error ? err.message : String(err)}`
          });
        });
      }
    }
  }
  function cleanup() {
    running = false;
    if (readline) {
      readline.close();
      readline = null;
    }
    for (const [id, pending] of pendingRequests) {
      clearTimeout(pending.timer);
      pending.resolve(createErrorResponse(id, PLUGIN_RPC_ERROR_CODES.WORKER_UNAVAILABLE, "Worker RPC host is shutting down"));
    }
    pendingRequests.clear();
    sessionEventCallbacks.clear();
  }
  let readline = createInterface({
    input: stdinStream,
    crlfDelay: Infinity
  });
  readline.on("line", handleLine);
  readline.on("close", () => {
    if (running) {
      cleanup();
      if (!options.stdin && !options.stdout) {
        process.exit(0);
      }
    }
  });
  if (!options.stdin && !options.stdout) {
    process.on("uncaughtException", (err) => {
      notifyHost("log", {
        level: "error",
        message: `Uncaught exception: ${err.message}`,
        meta: { stack: err.stack }
      });
      setTimeout(() => process.exit(1), 100);
    });
    process.on("unhandledRejection", (reason) => {
      const message = reason instanceof Error ? reason.message : String(reason);
      const stack = reason instanceof Error ? reason.stack : void 0;
      notifyHost("log", {
        level: "error",
        message: `Unhandled rejection: ${message}`,
        meta: { stack }
      });
    });
  }
  return {
    get running() {
      return running;
    },
    stop() {
      cleanup();
    }
  };
}

// src/github-client.ts
var API_BASE = "https://api.github.com";
var DEFAULT_TIMEOUT_MS = 8e3;
var GitHubClient = class {
  getToken;
  org;
  timeoutMs;
  baseUrl;
  constructor(config) {
    if (config.getToken) {
      this.getToken = config.getToken;
    } else if (config.token != null) {
      const t = config.token;
      this.getToken = async () => t;
    } else {
      throw new Error("GitHubClient requires either `token` or `getToken`");
    }
    this.org = config.org;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.baseUrl = (config.baseUrl ?? API_BASE).replace(/\/$/, "");
  }
  async request(method, repo, pathAndQuery, body) {
    const canRetry = typeof this.getToken.invalidate === "function";
    const maxAttempts = canRetry ? 2 : 1;
    let lastErr;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const res = await this.attempt(method, repo, pathAndQuery, body);
      if (res.ok || res.status !== 401 || attempt === maxAttempts) return res;
      this.getToken.invalidate?.(repo);
      lastErr = res;
    }
    return lastErr ?? { ok: false, error: "request failed" };
  }
  async attempt(method, repo, pathAndQuery, body) {
    let token;
    try {
      token = await this.getToken(repo);
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "token unavailable"
      };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}${pathAndQuery}`, {
        method,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          ...body !== void 0 ? { "Content-Type": "application/json" } : {}
        },
        ...body !== void 0 ? { body: JSON.stringify(body) } : {}
      });
      const rawBody = await res.text();
      let json = {};
      if (rawBody) {
        try {
          json = JSON.parse(rawBody);
        } catch {
        }
      }
      if (!res.ok) {
        const errors = Array.isArray(json.errors) ? json.errors : void 0;
        const detail = errors?.length ? errors.map(
          (e) => [e.resource, e.field, e.code, e.message].filter(Boolean).join(".")
        ).join("; ") : void 0;
        const base = json.message ?? (rawBody ? `HTTP ${res.status}: ${rawBody.slice(0, 200)}` : `HTTP ${res.status}`);
        return {
          ok: false,
          status: res.status,
          error: detail ? `${base} (${detail})` : base,
          ...errors ? { errors } : {}
        };
      }
      return { ok: true, data: json };
    } catch (err) {
      const error = err instanceof Error ? err.name === "AbortError" ? `request timed out after ${this.timeoutMs}ms` : err.message : "github unreachable";
      return { ok: false, error };
    } finally {
      clearTimeout(timer);
    }
  }
  parseIssue(raw) {
    return {
      number: Number(raw.number),
      title: String(raw.title ?? ""),
      body: typeof raw.body === "string" ? raw.body : "",
      state: raw.state === "closed" ? "closed" : "open",
      htmlUrl: String(raw.html_url ?? ""),
      labels: Array.isArray(raw.labels) ? raw.labels.map((l) => typeof l === "string" ? l : String(l?.name ?? "")).filter(Boolean) : []
    };
  }
  /** Create a new issue in `<org>/<repo>`. */
  async createIssue(repo, input) {
    const res = await this.request(
      "POST",
      repo,
      `/repos/${this.org}/${repo}/issues`,
      {
        title: input.title,
        body: input.body,
        ...input.labels ? { labels: input.labels } : {}
      }
    );
    if (!res.ok) return res;
    return { ok: true, data: this.parseIssue(res.data) };
  }
  /** Update an existing issue (title/body/state/labels) by number. */
  async updateIssue(repo, num, input) {
    const patch = {};
    if (input.title !== void 0) patch.title = input.title;
    if (input.body !== void 0) patch.body = input.body;
    if (input.state !== void 0) patch.state = input.state;
    if (input.labels !== void 0) patch.labels = input.labels;
    const res = await this.request(
      "PATCH",
      repo,
      `/repos/${this.org}/${repo}/issues/${num}`,
      patch
    );
    if (!res.ok) return res;
    return { ok: true, data: this.parseIssue(res.data) };
  }
  /** Fetch a single issue by number. */
  async getIssue(repo, num) {
    const res = await this.request(
      "GET",
      repo,
      `/repos/${this.org}/${repo}/issues/${num}`
    );
    if (!res.ok) return res;
    return { ok: true, data: this.parseIssue(res.data) };
  }
  /**
   * List a repo's issues (GOL-1206 inbound-close reconcile sweep). GitHub's
   * `/issues` endpoint returns BOTH issues and pull requests — a PR item carries
   * a `pull_request` object — so any item with that key is dropped: this sweep
   * only reconciles *issue* closures back onto Paperclip mirrors (PR closes drive
   * the review/CI pipelines, not the mirror). Paginated at 100/page and capped at
   * `maxPages` to bound cost; `truncated` reports whether the cap cut the scan
   * short. `since` (ISO 8601) filters to issues updated at/after that instant so an
   * hourly sweep only re-examines recently-touched issues; `sort=updated&desc`
   * keeps the freshest closures in the first page(s).
   */
  async listIssues(repo, opts) {
    const PER_PAGE = 100;
    const maxPages = opts.maxPages ?? 5;
    const issues = [];
    for (let page = 1; page <= maxPages; page++) {
      const qs = new URLSearchParams({
        state: opts.state,
        per_page: String(PER_PAGE),
        page: String(page),
        sort: "updated",
        direction: "desc"
      });
      if (opts.since) qs.set("since", opts.since);
      const res = await this.request(
        "GET",
        repo,
        `/repos/${this.org}/${repo}/issues?${qs.toString()}`
      );
      if (!res.ok) return res;
      const batch = Array.isArray(res.data) ? res.data : [];
      for (const raw of batch) {
        if (raw && raw.pull_request) continue;
        issues.push(this.parseIssue(raw));
      }
      if (batch.length < PER_PAGE) return { ok: true, data: { issues, truncated: false } };
    }
    return { ok: true, data: { issues, truncated: true } };
  }
  /**
   * List a PR's changed-file paths (GOL-158). Paginated at 100/page, capped at
   * MAX_FILE_PAGES to bound cost; the `truncated` flag says whether the cap was
   * hit so the caller can log it (frontendPaths matching stays correct — a match
   * in the first pages is enough; a giant PR that only touches frontend beyond
   * page N is the rare miss we accept for a bounded request budget).
   */
  async listPullFiles(repo, num) {
    const MAX_FILE_PAGES = 10;
    const PER_PAGE = 100;
    const files = [];
    for (let page = 1; page <= MAX_FILE_PAGES; page++) {
      const res = await this.request(
        "GET",
        repo,
        `/repos/${this.org}/${repo}/pulls/${num}/files?per_page=${PER_PAGE}&page=${page}`
      );
      if (!res.ok) return res;
      const batch = Array.isArray(res.data) ? res.data : [];
      for (const f of batch) {
        if (f && typeof f.filename === "string") files.push(f.filename);
      }
      if (batch.length < PER_PAGE) return { ok: true, data: { files, truncated: false } };
    }
    return { ok: true, data: { files, truncated: true } };
  }
  /**
   * Create a check-run on `headSha` (GOL-158 sign-off mechanism). Pass no
   * `conclusion` to seed/reset a pending run (`status: "in_progress"`); pass a
   * conclusion to complete it. Requires the App's `checks:write` permission.
   */
  async createCheckRun(repo, input) {
    const body = {
      name: input.name,
      head_sha: input.headSha,
      output: { title: input.title, summary: input.summary },
      ...input.detailsUrl ? { details_url: input.detailsUrl } : {}
    };
    if (input.conclusion) {
      body.status = "completed";
      body.conclusion = input.conclusion;
      body.completed_at = (/* @__PURE__ */ new Date()).toISOString();
    } else {
      body.status = "in_progress";
    }
    const res = await this.request(
      "POST",
      repo,
      `/repos/${this.org}/${repo}/check-runs`,
      body
    );
    if (!res.ok) return res;
    return { ok: true, data: { id: Number(res.data.id) } };
  }
  /**
   * Fetch a PR's author + head SHA + state (GOL-305). The CI-fix loop gates on
   * `authorLogin === agenticos-developer[bot]` (agent-authored PRs only) and needs
   * the head SHA to key idempotency. `merged` distinguishes a merged PR from a
   * plain close.
   */
  async getPull(repo, num) {
    const res = await this.request(
      "GET",
      repo,
      `/repos/${this.org}/${repo}/pulls/${num}`
    );
    if (!res.ok) return res;
    const raw = res.data;
    return {
      ok: true,
      data: {
        number: Number(raw.number),
        title: String(raw.title ?? ""),
        authorLogin: String(raw.user?.login ?? ""),
        headSha: String(raw.head?.sha ?? ""),
        htmlUrl: String(raw.html_url ?? ""),
        state: raw.state === "closed" ? "closed" : "open",
        draft: raw.draft === true,
        merged: raw.merged === true
      }
    };
  }
  /**
   * Fetch a single commit's parents + committer. Used by the `synchronize`
   * classifier to tell a GitHub-generated base-sync merge (Update branch) from
   * real author commits: GitHub's update-branch produces a 2-parent merge whose
   * first parent is the previous PR head and whose committer is `web-flow`.
   * Requires only `contents:read`.
   */
  async getCommit(repo, sha) {
    const res = await this.request(
      "GET",
      repo,
      `/repos/${this.org}/${repo}/commits/${sha}`
    );
    if (!res.ok) return res;
    const raw = res.data;
    const parents = Array.isArray(raw.parents) ? raw.parents : [];
    return {
      ok: true,
      data: {
        sha: String(raw.sha ?? ""),
        parents: parents.map((p) => String(p?.sha ?? "")),
        committerLogin: String(raw.committer?.login ?? "")
      }
    };
  }
  /**
   * List the check-runs for a commit ref (GOL-305). Used to derive the aggregate CI
   * state on a PR head SHA regardless of whether a `check_suite` or `workflow_run`
   * event triggered us. Single page at 100 (a suite rarely exceeds that); `output`
   * gives a short human excerpt for the fix issue without downloading job logs.
   * Requires the App's `checks:read` permission.
   */
  async listCommitCheckRuns(repo, sha) {
    const res = await this.request(
      "GET",
      repo,
      `/repos/${this.org}/${repo}/commits/${sha}/check-runs?per_page=100`
    );
    if (!res.ok) return res;
    const runs = Array.isArray(res.data?.check_runs) ? res.data.check_runs : [];
    return {
      ok: true,
      data: runs.map((r) => {
        const output = r?.output ?? {};
        const summary = typeof output.summary === "string" && output.summary ? output.summary : typeof output.title === "string" ? output.title : void 0;
        return {
          name: String(r?.name ?? ""),
          status: String(r?.status ?? ""),
          conclusion: typeof r?.conclusion === "string" ? r.conclusion : null,
          ...typeof r?.details_url === "string" && r.details_url ? { detailsUrl: r.details_url } : {},
          ...summary ? { summary } : {}
        };
      })
    };
  }
  /** Comment on an issue or PR (PRs share the issues comments endpoint). */
  async createIssueComment(repo, num, body) {
    const res = await this.request(
      "POST",
      repo,
      `/repos/${this.org}/${repo}/issues/${num}/comments`,
      { body }
    );
    if (!res.ok) return res;
    return { ok: true, data: { id: Number(res.data.id) } };
  }
};

// src/broker.ts
var EXPIRY_SKEW_MS = 2 * 60 * 1e3;
function makeBrokerTokenProvider(brokerUrl, owner, opts = {}) {
  const ttlMs = opts.ttlMs ?? 50 * 60 * 1e3;
  const timeoutMs = opts.timeoutMs ?? 5e3;
  const now = opts.now ?? (() => Date.now());
  const doFetch = opts.fetchImpl ?? fetch;
  const apiKey = (opts.apiKey ?? "").trim();
  const base = brokerUrl.replace(/\/$/, "");
  const cache = /* @__PURE__ */ new Map();
  const provider = async (repo) => {
    const key = `${owner}/${repo}`.toLowerCase();
    const hit = cache.get(key);
    if (hit && hit.expiresAt > now()) return hit.token;
    const url = new URL(`${base}/token`);
    url.searchParams.set("owner", owner);
    url.searchParams.set("repo", repo);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await doFetch(url.toString(), {
        signal: controller.signal,
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
      });
      if (!res.ok) throw new Error(`token broker -> ${res.status}`);
      const body = await res.json();
      if (!body.token) throw new Error("token broker returned no token");
      const ttlExpiry = now() + ttlMs;
      const realExpiry = body.expires_at ? Date.parse(body.expires_at) - EXPIRY_SKEW_MS : NaN;
      const expiresAt = Number.isFinite(realExpiry) ? Math.min(ttlExpiry, realExpiry) : ttlExpiry;
      if (expiresAt > now()) cache.set(key, { token: body.token, expiresAt });
      return body.token;
    } finally {
      clearTimeout(timer);
    }
  };
  provider.invalidate = (repo) => {
    cache.delete(`${owner}/${repo}`.toLowerCase());
  };
  return provider;
}
function staticTokenProvider(token) {
  return async () => token;
}

// src/mapping.ts
var MAPPING_TABLE = "github_sync_mapping";
function qualifiedTable(db) {
  return `${db.namespace}.${MAPPING_TABLE}`;
}
function toRow(raw) {
  return {
    paperclipIssueId: String(raw.paperclip_issue_id),
    githubRepo: String(raw.github_repo),
    githubIssueNumber: Number(raw.github_issue_number),
    lastSyncedAt: String(raw.last_synced_at),
    origin: raw.origin === "github" ? "github" : "paperclip"
  };
}
async function getByPaperclipId(db, paperclipIssueId) {
  const rows = await db.query(
    `SELECT paperclip_issue_id, github_repo, github_issue_number, last_synced_at, origin
       FROM ${qualifiedTable(db)} WHERE paperclip_issue_id = $1`,
    [paperclipIssueId]
  );
  const first = rows[0];
  return first ? toRow(first) : null;
}
function bareRepoName(githubRepo) {
  const slash = githubRepo.lastIndexOf("/");
  return slash >= 0 ? githubRepo.slice(slash + 1) : githubRepo;
}
async function getByRepoNumber(db, githubRepo, githubIssueNumber) {
  const rows = await db.query(
    `SELECT paperclip_issue_id, github_repo, github_issue_number, last_synced_at, origin
       FROM ${qualifiedTable(db)}
      WHERE github_issue_number = $1
        AND lower(regexp_replace(github_repo, '^[^/]+/', '')) = lower($2)`,
    [githubIssueNumber, bareRepoName(githubRepo)]
  );
  const first = rows[0];
  return first ? toRow(first) : null;
}
async function deleteByPaperclipIssueId(db, paperclipIssueId) {
  const res = await db.execute(
    `DELETE FROM ${qualifiedTable(db)} WHERE paperclip_issue_id = $1`,
    [paperclipIssueId]
  );
  return res.rowCount;
}
async function upsert(db, row) {
  await db.execute(
    `INSERT INTO ${qualifiedTable(db)}
       (paperclip_issue_id, github_repo, github_issue_number, last_synced_at, origin)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (paperclip_issue_id) DO UPDATE SET
       github_repo = $2,
       github_issue_number = $3,
       last_synced_at = $4,
       origin = $5`,
    [
      row.paperclipIssueId,
      row.githubRepo,
      row.githubIssueNumber,
      row.lastSyncedAt,
      row.origin
    ]
  );
}

// src/inbound.ts
import { createHmac, timingSafeEqual } from "node:crypto";
function getHeader(headers, name) {
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return Array.isArray(v) ? v[0] : v;
  }
  return void 0;
}
function verifyGithubSignature(rawBody, secret, signatureHeader) {
  if (!signatureHeader || !secret) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")}`;
  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
function parseInboundPayload(raw) {
  if (!raw || typeof raw !== "object") return null;
  const o = raw;
  const repo = typeof o.repo === "string" ? o.repo : "";
  const number = typeof o.number === "number" ? o.number : Number(o.number);
  const title = typeof o.title === "string" ? o.title : "";
  if (!repo || !Number.isFinite(number) || number <= 0 || !title) return null;
  return {
    repo,
    number,
    title,
    body: typeof o.body === "string" ? o.body : "",
    url: typeof o.url === "string" ? o.url : ""
  };
}
function parseGithubAppIssueEvent(raw) {
  if (!raw || typeof raw !== "object") return null;
  const o = raw;
  const action = typeof o.action === "string" ? o.action : "";
  const repository = o.repository ?? {};
  const issue = o.issue ?? {};
  const repo = typeof repository.full_name === "string" ? repository.full_name : "";
  const number = typeof issue.number === "number" ? issue.number : Number(issue.number);
  const title = typeof issue.title === "string" ? issue.title : "";
  if (!repo || !Number.isFinite(number) || number <= 0 || !title) return null;
  const rawLabels = Array.isArray(issue.labels) ? issue.labels : [];
  const labels = rawLabels.map((l) => l && typeof l === "object" ? l.name : l).filter((n) => typeof n === "string");
  return {
    action,
    labels,
    payload: {
      repo,
      number,
      title,
      body: typeof issue.body === "string" ? issue.body : "",
      url: typeof issue.html_url === "string" ? issue.html_url : ""
    }
  };
}
function githubMarker(repo, num) {
  return `<!-- synced-from-github: ${repo}#${num} -->`;
}
function buildInboundDescription(p) {
  return `${githubMarker(p.repo, p.number)}

${p.body}

---
Synced from GitHub: ${p.url}`;
}
function buildMirrorOpsMessage(info) {
  const via = info.routedByLabel ? ` via label \`${info.routedByLabel}\`` : info.routedByFallback ? " (fallback triage \u2014 no routing label)" : "";
  const who = info.assigneeAgentId ? `assigned \u2192 \`${info.assigneeAgentId}\`${via}` : "\u26A0\uFE0F UNASSIGNED \u2014 set the bridge's `labelRouting`/`fallbackAssigneeAgentId` (or `defaultAssigneeAgentId`) so it gets picked up";
  const link = info.url ? ` (<${info.url}>)` : "";
  return `\u{1F501} GitHub \u2192 Paperclip mirror created: **${info.title}** [${info.repo}#${info.number}]${link} \u2014 ${who} in project \`${info.projectId}\` \xB7 issue \`${info.issueId}\``;
}

// src/sync.ts
var GITHUB_MARKER_RE = /<!--\s*synced-from-github:\s*([^\s#]+)#(\d+)\s*-->/i;
var PLUGIN_OPERATIONAL_MARKER_RE = /<!--\s*(pr-review|ci-fix):/i;
function isPluginOperationalIssue(description) {
  return !!description && PLUGIN_OPERATIONAL_MARKER_RE.test(description);
}
function statusToGithubState(status) {
  return status === "done" || status === "cancelled" ? "closed" : "open";
}
function isTerminalStatus(status) {
  return status === "done" || status === "cancelled";
}
function resolveMirrorClosureStatus(action, currentStatus) {
  if (action === "closed") return isTerminalStatus(currentStatus) ? null : "done";
  if (action === "reopened") return isTerminalStatus(currentStatus) ? "todo" : null;
  return null;
}
function detectGithubMarker(description) {
  if (!description) return null;
  const m = GITHUB_MARKER_RE.exec(description);
  if (!m) return null;
  return { repo: m[1], number: Number(m[2]) };
}
function paperclipMarker(paperclipIssueId) {
  return `<!-- synced-from-paperclip: ${paperclipIssueId} -->`;
}
function buildGithubBody(issue) {
  const description = issue.description ?? "";
  const ref = issue.identifier ? `Paperclip issue ${issue.identifier}` : `Paperclip issue ${issue.id}`;
  const footer = `

---
_Synced from ${ref}._
${paperclipMarker(issue.id)}`;
  return `${description}${footer}`;
}
async function handleIssueCreated(deps, input) {
  const { db, github, config, logger, getIssue } = deps;
  const existing = await getByPaperclipId(db, input.issueId);
  if (existing) {
    logger.info("issue.created already mapped; skipping", { issueId: input.issueId });
    return;
  }
  const issue = await getIssue(input.issueId, input.companyId);
  if (!issue) {
    logger.warn("issue.created: issue not readable; skipping", { issueId: input.issueId });
    return;
  }
  if (isPluginOperationalIssue(issue.description)) {
    logger.info("issue.created is a plugin-operational issue (pr-review/ci-fix); not mirrored", {
      issueId: issue.id
    });
    return;
  }
  const marker = detectGithubMarker(issue.description);
  if (marker) {
    await upsert(db, {
      paperclipIssueId: issue.id,
      githubRepo: marker.repo,
      githubIssueNumber: marker.number,
      lastSyncedAt: (/* @__PURE__ */ new Date()).toISOString(),
      origin: "github"
    });
    logger.info("issue.created originated from GitHub; recorded mapping, no outbound", {
      issueId: issue.id,
      githubRepo: marker.repo,
      githubIssueNumber: marker.number
    });
    return;
  }
  const created = await github.createIssue(config.githubRepo, {
    title: issue.title,
    body: buildGithubBody(issue),
    labels: [config.syncLabelPaperclip]
  });
  if (!created.ok) {
    logger.error("issue.created: failed to create GitHub issue", {
      issueId: issue.id,
      error: created.error
    });
    return;
  }
  await upsert(db, {
    paperclipIssueId: issue.id,
    githubRepo: config.githubRepo,
    githubIssueNumber: created.data.number,
    lastSyncedAt: (/* @__PURE__ */ new Date()).toISOString(),
    origin: "paperclip"
  });
  logger.info("issue.created mirrored to GitHub", {
    issueId: issue.id,
    githubRepo: config.githubRepo,
    githubIssueNumber: created.data.number
  });
}
async function handleIssueUpdated(deps, input) {
  const { db, github, config, logger, getIssue } = deps;
  const mapping = await getByPaperclipId(db, input.issueId);
  if (!mapping) {
    logger.info("issue.updated: not mapped; ignoring", { issueId: input.issueId });
    return;
  }
  const issue = await getIssue(input.issueId, input.companyId);
  if (!issue) {
    logger.warn("issue.updated: issue not readable; skipping", { issueId: input.issueId });
    return;
  }
  const fullPatch = {
    title: issue.title,
    body: buildGithubBody(issue),
    state: statusToGithubState(issue.status)
  };
  let updated = await github.updateIssue(
    mapping.githubRepo,
    mapping.githubIssueNumber,
    fullPatch
  );
  if (!updated.ok && updated.status === 422 && updated.errors?.some((e) => e.field)) {
    const rejected = new Set(
      updated.errors.map((e) => e.field).filter((f) => Boolean(f))
    );
    const sanitized = {};
    if (!rejected.has("title")) sanitized.title = fullPatch.title;
    if (!rejected.has("body")) sanitized.body = fullPatch.body;
    if (!rejected.has("state")) sanitized.state = fullPatch.state;
    if (Object.keys(sanitized).length > 0) {
      logger.warn("issue.updated: GitHub rejected field(s); retrying sanitized payload", {
        issueId: issue.id,
        githubRepo: mapping.githubRepo,
        githubIssueNumber: mapping.githubIssueNumber,
        rejectedFields: [...rejected],
        githubErrors: updated.errors
      });
      updated = await github.updateIssue(
        mapping.githubRepo,
        mapping.githubIssueNumber,
        sanitized
      );
    }
  }
  if (!updated.ok) {
    logger.error("issue.updated: failed to update GitHub issue", {
      issueId: issue.id,
      githubRepo: mapping.githubRepo,
      githubIssueNumber: mapping.githubIssueNumber,
      error: updated.error,
      githubStatus: updated.status,
      githubErrors: updated.errors
    });
    return;
  }
  const next = { ...mapping, lastSyncedAt: (/* @__PURE__ */ new Date()).toISOString() };
  await upsert(db, next);
  logger.info("issue.updated pushed to GitHub", {
    issueId: issue.id,
    githubRepo: mapping.githubRepo,
    githubIssueNumber: mapping.githubIssueNumber,
    state: statusToGithubState(issue.status)
  });
}

// src/routing.ts
var PRECEDENCE_TIERS = [
  ["infra", "bug", "alert"],
  ["frontend"],
  ["feature"]
];
function tierRank(label) {
  const l = label.toLowerCase();
  for (let i = 0; i < PRECEDENCE_TIERS.length; i++) {
    const tier = PRECEDENCE_TIERS[i];
    if (tier && tier.includes(l)) return i;
  }
  return PRECEDENCE_TIERS.length;
}
function resolveRouting(cfg, labels) {
  const routing = cfg.labelRouting;
  if (routing) {
    const present = new Set(labels.map((l) => l.toLowerCase()));
    const candidates = Object.keys(routing).filter((k) => present.has(k.toLowerCase()));
    candidates.sort((a, b) => tierRank(a) - tierRank(b));
    const key = candidates[0];
    if (key !== void 0) {
      return { assigneeAgentId: routing[key], matchedLabel: key, reason: "label" };
    }
  }
  if (cfg.fallbackAssigneeAgentId) {
    return { assigneeAgentId: cfg.fallbackAssigneeAgentId, reason: "fallback" };
  }
  if (cfg.defaultAssigneeAgentId) {
    return { assigneeAgentId: cfg.defaultAssigneeAgentId, reason: "default" };
  }
  return { reason: "none" };
}

// src/pr-review.ts
var CHECK_CONTEXT = {
  ada: "agent-review/ada",
  iris: "agent-review/iris"
};
var REVIEWER_NAME = { ada: "Ada", iris: "Iris" };
var PR_ACTIONS = ["opened", "reopened", "ready_for_review", "synchronize"];
var DEFAULT_FRONTEND_PATHS = ["apps/dashboard/**", "**/*.tsx", "**/*.css"];
function isActionablePrAction(action) {
  return PR_ACTIONS.includes(action);
}
function parseGithubPrEvent(raw) {
  if (!raw || typeof raw !== "object") return null;
  const o = raw;
  const action = typeof o.action === "string" ? o.action : "";
  const repository = o.repository ?? {};
  const pr = o.pull_request ?? {};
  const head = pr.head ?? {};
  const repo = typeof repository.full_name === "string" ? repository.full_name : "";
  const rawNumber = pr.number ?? o.number;
  const number = typeof rawNumber === "number" ? rawNumber : Number(rawNumber);
  const title = typeof pr.title === "string" ? pr.title : "";
  const headSha = typeof head.sha === "string" ? head.sha : "";
  if (!repo || !Number.isFinite(number) || number <= 0 || !headSha) return null;
  return {
    action,
    draft: pr.draft === true,
    repo,
    number,
    title,
    headSha,
    url: typeof pr.html_url === "string" ? pr.html_url : "",
    before: typeof o.before === "string" ? o.before : "",
    after: typeof o.after === "string" ? o.after : ""
  };
}
function shortSha(sha) {
  return sha.length > 7 ? sha.slice(0, 7) : sha;
}
function decideReviewAction(priorHeadSha, newHeadSha) {
  if (priorHeadSha === null) return "create";
  return priorHeadSha === newHeadSha ? "noop" : "reopen";
}
var GITHUB_MERGE_COMMITTER = "web-flow";
function classifyHeadChange(input) {
  const { before, head } = input;
  if (!before || !head) return "author-work";
  if (head.parents.length !== 2) return "author-work";
  if (head.parents[0] !== before) return "author-work";
  if (head.committerLogin !== GITHUB_MERGE_COMMITTER) return "author-work";
  return "base-sync";
}
function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        i++;
        if (glob[i + 1] === "/") {
          i++;
          re += "(?:.*/)?";
        } else {
          re += ".*";
        }
      } else {
        re += "[^/]*";
      }
    } else if (/[.+?^${}()|[\]\\]/.test(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  return new RegExp("^" + re + "$");
}
function anyFrontendMatch(files, globs) {
  const res = globs.map(globToRegExp);
  return files.some((f) => res.some((r) => r.test(f)));
}
function prReviewMarker(repo, num, sha) {
  return `<!-- pr-review: ${repo}#${num}@${sha} -->`;
}
function buildReviewIssueTitle(reviewer, ev) {
  const scope = reviewer === "iris" ? " (frontend)" : "";
  return `Review PR ${ev.repo}#${ev.number}${scope} \u2014 ${ev.title}`;
}
function buildReviewIssueBody(reviewer, ev, files) {
  const shown = files.slice(0, 50);
  const fileLines = shown.length ? shown.map((f) => `- \`${f}\``).join("\n") + (files.length > shown.length ? `
- \u2026and ${files.length - shown.length} more` : "") : "- _(no files reported)_";
  const context = CHECK_CONTEXT[reviewer];
  return [
    prReviewMarker(ev.repo, ev.number, ev.headSha),
    "",
    `**PR:** ${ev.url || `${ev.repo}#${ev.number}`}`,
    `**Head SHA:** \`${ev.headSha}\``,
    `**Reviewer:** ${REVIEWER_NAME[reviewer]} (\`${context}\`)`,
    "",
    `### Changed files (${files.length})`,
    fileLines,
    "",
    "### Review checklist",
    "- [ ] Correctness \u2014 logic, edge cases, error handling",
    reviewer === "iris" ? "- [ ] Frontend \u2014 accessibility, responsive layout, design-system reuse" : "- [ ] Reuse/simplification, tests, security-sensitive changes flagged",
    "- [ ] Sign off: close this issue `done` \u2014 the plugin then posts `" + context + "` = success on the head SHA. To request changes, comment on the PR and leave this open (the check stays pending).",
    "",
    "_Non-required check during Phase 2 soak (GOL-158). Merge gate flips in Phase 3._"
  ].join("\n");
}
function buildNewCommitsNote(reviewer, ev) {
  return `\u{1F501} New commits pushed \u2014 head is now \`${ev.headSha}\` (${ev.url || `${ev.repo}#${ev.number}`}). Re-review against the new head SHA and re-post the \`${CHECK_CONTEXT[reviewer]}\` check-run (previous sign-off is stale).`;
}
function evaluateSignoffGate(input) {
  const out = [];
  if (input.irisPresent && input.irisDone) out.push("iris");
  if (input.adaDone && (!input.irisPresent || input.irisDone)) out.push("ada");
  return out;
}
function reviewerList(reviewers) {
  return reviewers.map((r) => REVIEWER_NAME[r]).join(" + ") || "\u2014";
}
function buildReviewIssuesCreatedPing(ev, reviewers) {
  return `\u{1F50D} PR ${ev.repo}#${ev.number} \u2192 review: ${reviewerList(reviewers)} \u2014 <${ev.url || ev.repo}>`;
}
function buildReReviewPing(ev, reviewers) {
  return `\u{1F501} PR ${ev.repo}#${ev.number} new commits (\`${shortSha(ev.headSha)}\`) \u2192 re-review: ${reviewerList(reviewers)}`;
}
function buildSignoffPing(reviewers, repo, prNumber) {
  const checks = reviewers.map((r) => CHECK_CONTEXT[r]).join(" + ");
  return `\u2705 PR ${repo}#${prNumber} ${checks} \u2014 green`;
}
function buildPipelineErrorPing(detail) {
  return `\u{1F525} PR review pipeline error: ${detail}`;
}
function isNullBodyStatusError(err) {
  const msg = err instanceof Error ? err.message : String(err);
  return /invalid response status code (204|205|304)/i.test(msg);
}

// src/pr-review-store.ts
var PR_REVIEW_TABLE = "github_pr_review";
function qualified(db) {
  return `${db.namespace}.${PR_REVIEW_TABLE}`;
}
function toRow2(raw) {
  return {
    githubRepo: String(raw.github_repo),
    prNumber: Number(raw.pr_number),
    reviewer: String(raw.reviewer),
    headSha: String(raw.head_sha),
    paperclipIssueId: String(raw.paperclip_issue_id),
    updatedAt: String(raw.updated_at)
  };
}
async function getReviewRecord(db, githubRepo, prNumber, reviewer) {
  const rows = await db.query(
    `SELECT github_repo, pr_number, reviewer, head_sha, paperclip_issue_id, updated_at
       FROM ${qualified(db)}
      WHERE github_repo = $1 AND pr_number = $2 AND reviewer = $3`,
    [githubRepo, prNumber, reviewer]
  );
  const first = rows[0];
  return first ? toRow2(first) : null;
}
async function getReviewRecordByIssueId(db, paperclipIssueId) {
  const rows = await db.query(
    `SELECT github_repo, pr_number, reviewer, head_sha, paperclip_issue_id, updated_at
       FROM ${qualified(db)}
      WHERE paperclip_issue_id = $1
      LIMIT 1`,
    [paperclipIssueId]
  );
  const first = rows[0];
  return first ? toRow2(first) : null;
}
async function listReviewRecordsUpdatedSince(db, sinceIso, limit) {
  const rows = await db.query(
    `SELECT github_repo, pr_number, reviewer, head_sha, paperclip_issue_id, updated_at
       FROM ${qualified(db)}
      WHERE updated_at > $1
      ORDER BY updated_at DESC
      LIMIT $2`,
    [sinceIso, limit]
  );
  return rows.map(toRow2);
}
async function upsertReviewRecord(db, row) {
  await db.execute(
    `INSERT INTO ${qualified(db)}
       (github_repo, pr_number, reviewer, head_sha, paperclip_issue_id, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (github_repo, pr_number, reviewer) DO UPDATE SET
       head_sha = $4,
       paperclip_issue_id = $5,
       updated_at = $6`,
    [row.githubRepo, row.prNumber, row.reviewer, row.headSha, row.paperclipIssueId, row.updatedAt]
  );
}

// src/pr-signoff.ts
async function handleReviewSignoff(deps, input) {
  const { db, logger, getIssue } = deps;
  const record = await getReviewRecordByIssueId(db, input.issueId);
  if (!record) return;
  const triggerIssue = await getIssue(input.issueId, input.companyId);
  if (!triggerIssue) {
    logger.warn("signoff: review issue not readable; skipping", { issueId: input.issueId });
    return;
  }
  if (triggerIssue.status !== "done") return;
  const adaRow = await getReviewRecord(db, record.githubRepo, record.prNumber, "ada");
  const irisRow = await getReviewRecord(db, record.githubRepo, record.prNumber, "iris");
  const adaDone = adaRow ? await isIssueDone(deps, adaRow, input.companyId) : false;
  const irisDone = irisRow ? await isIssueDone(deps, irisRow, input.companyId) : false;
  const greenlit = evaluateSignoffGate({ adaDone, irisPresent: irisRow !== null, irisDone });
  if (greenlit.length === 0) {
    logger.info("signoff: gate not yet green; no check-run posted", {
      repo: record.githubRepo,
      prNumber: record.prNumber,
      adaDone,
      irisPresent: irisRow !== null,
      irisDone
    });
    return;
  }
  const posted = [];
  for (const reviewer of greenlit) {
    const row = reviewer === "ada" ? adaRow : irisRow;
    if (!row) continue;
    if (await postSignoffCheck(deps, row, reviewer) === "posted") posted.push(reviewer);
  }
  if (posted.length > 0) {
    await deps.postOpsPing?.(buildSignoffPing(posted, record.githubRepo, record.prNumber));
  }
}
async function isIssueDone(deps, row, companyId) {
  const issue = await deps.getIssue(row.paperclipIssueId, companyId);
  return issue?.status === "done";
}
async function postSignoffCheck(deps, row, reviewer) {
  const { logger } = deps;
  const resolved = deps.resolveRepoClient?.(row.githubRepo) ?? null;
  if (deps.resolveRepoClient && !resolved) {
    logger.error("signoff: no bridge for the review row's repo \u2014 check-run not posted", {
      repo: row.githubRepo,
      prNumber: row.prNumber,
      reviewer,
      headSha: row.headSha
    });
    await deps.postOpsPing?.(
      buildPipelineErrorPing(
        `sign-off check-run skipped for ${row.githubRepo}#${row.prNumber} (${reviewer}): repo is not bridged`
      ),
      "error"
    );
    return "skipped";
  }
  const github = resolved ? resolved.github : deps.github;
  const repo = resolved ? resolved.repo : bareRepoName2(row.githubRepo);
  const res = await github.createCheckRun(repo, {
    name: CHECK_CONTEXT[reviewer],
    headSha: row.headSha,
    conclusion: "success",
    title: `Agent review complete (${reviewer})`,
    summary: `${reviewer} signed off ${row.githubRepo}#${row.prNumber} @ \`${shortSha(row.headSha)}\` (GOL-186).`
  });
  if (res.ok) {
    logger.info("signoff: posted green check-run", {
      repo: row.githubRepo,
      prNumber: row.prNumber,
      reviewer,
      headSha: row.headSha,
      checkRunId: res.data.id
    });
    return "posted";
  }
  if (isMissingCommitError(res)) {
    logSkipped(deps, row, reviewer, "reviewed head no longer exists (superseded/deleted)", res.error);
    return "skipped";
  }
  const state = await github.getPull(repo, row.prNumber);
  if (state.ok && isClosedPull(state.data)) {
    logSkipped(deps, row, reviewer, state.data.merged ? "PR merged" : "PR closed", res.error);
    return "skipped";
  }
  if (isTransientFailure(res)) {
    logger.warn("signoff: check-run completion failed (transient; will retry)", {
      repo: row.githubRepo,
      prNumber: row.prNumber,
      reviewer,
      headSha: row.headSha,
      status: res.status,
      error: res.error
    });
    return "skipped";
  }
  logger.error("signoff: check-run completion failed", {
    repo: row.githubRepo,
    prNumber: row.prNumber,
    reviewer,
    headSha: row.headSha,
    status: res.status,
    error: res.error,
    errors: res.errors
  });
  await deps.postOpsPing?.(
    buildPipelineErrorPing(
      `sign-off check-run failed for ${row.githubRepo}#${row.prNumber} (${reviewer}): HTTP ${res.status ?? "?"} ${res.error}`
    ),
    "error"
  );
  return "skipped";
}
function isTransientFailure(res) {
  const s = res.status;
  if (s === void 0) return true;
  return s === 401 || s === 408 || s === 429 || s >= 500;
}
function bareRepoName2(slug) {
  const idx = slug.lastIndexOf("/");
  return idx === -1 ? slug : slug.slice(idx + 1);
}
function isClosedPull(pull) {
  return pull.merged || pull.state === "closed";
}
function isMissingCommitError(err) {
  return /no commit found for sha/i.test(err.error);
}
function logSkipped(deps, row, reviewer, reason, detail) {
  deps.logger.info("signoff: skipping check-run completion (benign, nothing to gate)", {
    repo: row.githubRepo,
    prNumber: row.prNumber,
    reviewer,
    headSha: row.headSha,
    reason,
    detail
  });
}

// src/reconcile.ts
var PAGE_SIZE = 100;
var DEFAULT_MAX_CREATES = 20;
var ACTIVE_STATUSES = ["backlog", "todo", "in_progress", "in_review", "blocked"];
async function runMirrorReconcile(input) {
  const maxCreates = input.maxCreates ?? DEFAULT_MAX_CREATES;
  const summary = {
    scanned: 0,
    created: 0,
    skippedMapped: 0,
    skippedTerminal: 0,
    skippedPluginOp: 0,
    failed: 0,
    capped: false
  };
  for (const projectId of input.projectIds) {
    const deps = input.depsForProject(projectId);
    if (!deps) continue;
    for (const status of ACTIVE_STATUSES) {
      for (let offset = 0; ; offset += PAGE_SIZE) {
        const page = await input.listIssues(projectId, status, offset, PAGE_SIZE);
        for (const issue of page) {
          summary.scanned++;
          if (isTerminalStatus(issue.status)) {
            summary.skippedTerminal++;
            continue;
          }
          if (isPluginOperationalIssue(issue.description)) {
            summary.skippedPluginOp++;
            continue;
          }
          if (await getByPaperclipId(deps.db, issue.id)) {
            summary.skippedMapped++;
            continue;
          }
          if (summary.created + summary.failed >= maxCreates) {
            summary.capped = true;
            return summary;
          }
          try {
            await handleIssueCreated(deps, {
              issueId: issue.id,
              companyId: input.companyId
            });
            if (await getByPaperclipId(deps.db, issue.id)) {
              summary.created++;
            } else {
              summary.failed++;
            }
          } catch (err) {
            summary.failed++;
            input.logger.error("mirror-reconcile: mirror-create failed; continuing sweep", {
              issueId: issue.id,
              projectId,
              error: err instanceof Error ? err.message : String(err)
            });
          }
        }
        if (page.length < PAGE_SIZE) break;
      }
    }
  }
  return summary;
}
function buildReconcilePing(s) {
  const capNote = s.capped ? " \u2014 capped, next run continues" : "";
  return `\u{1F9F9} mirror-reconcile: created ${s.created} missing GitHub twin(s), ${s.failed} failed (scanned ${s.scanned})${capNote}`;
}

// src/signoff-reconcile.ts
function isSignoffCheckGreen(checks, reviewer) {
  const name = `agent-review/${reviewer}`;
  return checks.some((c) => c.name === name && c.status === "completed" && c.conclusion === "success");
}
async function runSignoffReconcile(input) {
  const summary = { scanned: 0, healed: 0, skipped: 0, failed: 0 };
  const rows = await input.listRows(input.sinceIso, input.limit);
  const driven = /* @__PURE__ */ new Set();
  const checkCache = /* @__PURE__ */ new Map();
  for (const row of rows) {
    summary.scanned++;
    const prKey = `${row.githubRepo}#${row.prNumber}`;
    if (driven.has(prKey)) {
      summary.skipped++;
      continue;
    }
    const status = await input.getIssueStatus(row.paperclipIssueId, input.companyId);
    if (status !== "done") {
      summary.skipped++;
      continue;
    }
    const resolved = input.resolveRepoClient(row.githubRepo);
    if (!resolved) {
      summary.skipped++;
      continue;
    }
    const cacheKey = `${resolved.repo}
${row.headSha}`;
    let checks = checkCache.get(cacheKey);
    if (checks === void 0) {
      const res = await resolved.github.listCommitCheckRuns(resolved.repo, row.headSha);
      checks = res.ok ? res.data : null;
      checkCache.set(cacheKey, checks);
    }
    if (checks === null) {
      summary.failed++;
      continue;
    }
    if (isSignoffCheckGreen(checks, row.reviewer)) {
      summary.skipped++;
      continue;
    }
    try {
      await input.driveSignoff(row.paperclipIssueId);
      driven.add(prKey);
      summary.healed++;
      input.logger.info("signoff-reconcile: re-drove stranded sign-off", {
        repo: row.githubRepo,
        prNumber: row.prNumber,
        reviewer: row.reviewer,
        headSha: row.headSha
      });
    } catch (err) {
      summary.failed++;
      input.logger.warn("signoff-reconcile: re-drive failed", {
        repo: row.githubRepo,
        prNumber: row.prNumber,
        reviewer: row.reviewer,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }
  return summary;
}

// src/inbound-close-reconcile.ts
async function runInboundCloseReconcile(input) {
  const summary = {
    scanned: 0,
    propagated: 0,
    skippedUnmapped: 0,
    skippedInSync: 0,
    pruned: 0,
    failed: 0,
    reposFailed: 0,
    truncated: false
  };
  for (const repoSlug of input.repoSlugs) {
    const listed = await input.listIssues(repoSlug);
    if (!listed.ok) {
      summary.reposFailed++;
      input.logger.warn("inbound-close-reconcile: issue list failed; skipping repo this run", {
        repo: repoSlug,
        error: listed.error
      });
      continue;
    }
    if (listed.truncated) summary.truncated = true;
    for (const issue of listed.issues) {
      summary.scanned++;
      const action = issue.state === "closed" ? "closed" : "reopened";
      try {
        const outcome = await input.driveClosure({ action, repoSlug, number: issue.number });
        switch (outcome) {
          case "propagated":
            summary.propagated++;
            break;
          case "in-sync":
            summary.skippedInSync++;
            break;
          case "unmapped":
          case "no-bridge":
            summary.skippedUnmapped++;
            break;
          case "pruned":
            summary.pruned++;
            break;
          case "unreadable":
          case "no-company":
            summary.failed++;
            break;
        }
      } catch (err) {
        summary.failed++;
        input.logger.warn("inbound-close-reconcile: closure re-drive failed; continuing sweep", {
          repo: repoSlug,
          number: issue.number,
          action,
          error: err instanceof Error ? err.message : String(err)
        });
      }
    }
  }
  return summary;
}
function buildInboundCloseReconcilePing(s) {
  return `\u{1F501} inbound-close-reconcile: propagated ${s.propagated} GitHub close(s) \u2192 Paperclip, pruned ${s.pruned} orphaned mapping(s), ${s.failed} failed (scanned ${s.scanned})`;
}

// src/inbound-create-reconcile.ts
var DEFAULT_MAX_CREATES2 = 20;
async function runInboundCreateReconcile(input) {
  const maxCreates = input.maxCreates ?? DEFAULT_MAX_CREATES2;
  const summary = {
    scanned: 0,
    created: 0,
    skippedMapped: 0,
    skippedClosed: 0,
    skippedPaperclipOrigin: 0,
    failed: 0,
    reposFailed: 0,
    truncated: false,
    capped: false
  };
  for (const repoSlug of input.repoSlugs) {
    const listed = await input.listIssues(repoSlug);
    if (!listed.ok) {
      summary.reposFailed++;
      input.logger.warn("inbound-create-reconcile: issue list failed; skipping repo this run", {
        repo: repoSlug,
        error: listed.error
      });
      continue;
    }
    if (listed.truncated) summary.truncated = true;
    for (const issue of listed.issues) {
      summary.scanned++;
      if (summary.created + summary.failed >= maxCreates) {
        summary.capped = true;
        return summary;
      }
      try {
        const outcome = await input.driveCreate({ repoSlug, issue });
        switch (outcome) {
          case "created":
            summary.created++;
            break;
          case "skipped-mapped":
            summary.skippedMapped++;
            break;
          case "skipped-closed":
            summary.skippedClosed++;
            break;
          case "skipped-paperclip-origin":
            summary.skippedPaperclipOrigin++;
            break;
          case "no-bridge":
            break;
          case "failed":
            summary.failed++;
            break;
        }
      } catch (err) {
        summary.failed++;
        input.logger.warn("inbound-create-reconcile: mirror-create re-drive failed; continuing sweep", {
          repo: repoSlug,
          number: issue.number,
          error: err instanceof Error ? err.message : String(err)
        });
      }
    }
  }
  return summary;
}
function buildInboundCreateReconcilePing(s) {
  const capNote = s.capped ? " \u2014 capped, next run continues" : "";
  return `\u{1FA9E} inbound-create-reconcile: created ${s.created} missing Paperclip twin(s), ${s.failed} failed (scanned ${s.scanned})${capNote}`;
}

// src/error-log.ts
var ERROR_TABLE = "github_sync_error";
function qualifiedTable2(db) {
  return `${db.namespace}.${ERROR_TABLE}`;
}
function buildSwallowedFailurePing(scope, detail) {
  const trimmed = detail.length > 500 ? `${detail.slice(0, 500)}\u2026` : detail;
  return `\u{1F6A8} github-sync failure \u2014 ${scope}: ${trimmed}`;
}
function buildFallbackFailurePing(site, status) {
  const code = status === void 0 ? "no HTTP status" : `HTTP ${status}`;
  return `\u26D4 github-sync REST fallback FAILED for ${site} (${code}) \u2014 the Paperclip REST fallback key may be dead (#457); inbound mirrors for this site will stop until it is fixed.`;
}
async function recordError(db, row) {
  await db.execute(
    `INSERT INTO ${qualifiedTable2(db)} (occurred_at, scope, detail, context)
       VALUES ($1, $2, $3, $4)`,
    [
      row.occurredAt,
      row.scope,
      row.detail,
      row.context && Object.keys(row.context).length > 0 ? JSON.stringify(row.context) : null
    ]
  );
}
var OpsPingThrottle = class {
  windowMs;
  windows = /* @__PURE__ */ new Map();
  constructor(windowMs = 5 * 6e4) {
    this.windowMs = windowMs;
  }
  /**
   * Decide whether the alert identified by `key` should be emitted at `now` (ms).
   * Pass a stable key — the ping content itself is a good choice, so only byte-for-byte
   * identical alerts collapse and a different error still pages immediately.
   */
  decide(key, now) {
    const w = this.windows.get(key);
    let decision;
    if (!w || now - w.openedAt >= this.windowMs) {
      const suppressed = w ? w.suppressed : 0;
      this.windows.set(key, { openedAt: now, lastAt: now, suppressed: 0 });
      decision = { emit: true, suppressed };
    } else {
      w.lastAt = now;
      w.suppressed += 1;
      decision = { emit: false, suppressed: w.suppressed };
    }
    this.prune(now);
    return decision;
  }
  /** Drop windows with no hit for a full window, so the Map can't grow unbounded. */
  prune(now) {
    for (const [key, w] of this.windows) {
      if (now - w.lastAt >= this.windowMs) this.windows.delete(key);
    }
  }
};
function withSuppressionNote(content, suppressed) {
  return suppressed > 0 ? `${content} (+${suppressed} identical alert${suppressed === 1 ? "" : "s"} suppressed)` : content;
}

// src/delivery-log.ts
var DELIVERY_TABLE = "github_sync_delivery";
function qualifiedTable3(db) {
  return `${db.namespace}.${DELIVERY_TABLE}`;
}
function trimDetail(detail) {
  if (!detail) return null;
  return detail.length > 1e3 ? `${detail.slice(0, 1e3)}\u2026` : detail;
}
async function recordDelivery(db, row) {
  await db.execute(
    `INSERT INTO ${qualifiedTable3(db)}
       (request_id, endpoint_key, event, delivery_guid, outcome, detail, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      row.requestId,
      row.endpointKey,
      row.event,
      row.deliveryGuid,
      row.outcome,
      trimDetail(row.detail),
      row.occurredAt
    ]
  );
}
var WebhookRejection = class extends Error {
  constructor(outcome, message, httpStatus = 401) {
    super(message);
    this.outcome = outcome;
    this.httpStatus = httpStatus;
    this.name = "WebhookRejection";
  }
  outcome;
  httpStatus;
};

// src/ci-failure.ts
var DEFAULT_AGENT_PR_AUTHOR = "agenticos-developer[bot]";
var AGENT_REVIEW_CHECK_PREFIX = "agent-review/";
var FAILING_CONCLUSIONS = /* @__PURE__ */ new Set([
  "failure",
  "timed_out",
  "cancelled",
  "action_required",
  "startup_failure",
  "stale"
]);
function asRecord(v) {
  return v && typeof v === "object" ? v : {};
}
function prNumbersFrom(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const pr of raw) {
    const n = Number(asRecord(pr).number);
    if (Number.isFinite(n) && n > 0) out.push(n);
  }
  return [...new Set(out)];
}
function parseCheckSuiteEvent(raw) {
  const o = asRecord(raw);
  const cs = asRecord(o.check_suite);
  const repository = asRecord(o.repository);
  const repo = typeof repository.full_name === "string" ? repository.full_name : "";
  const headSha = typeof cs.head_sha === "string" ? cs.head_sha : "";
  if (!repo || !headSha) return null;
  const app = asRecord(cs.app);
  return {
    kind: "check_suite",
    action: typeof o.action === "string" ? o.action : "",
    repo,
    headSha,
    conclusion: typeof cs.conclusion === "string" ? cs.conclusion : null,
    prNumbers: prNumbersFrom(cs.pull_requests),
    name: typeof app.name === "string" && app.name ? app.name : "CI",
    detailsUrl: ""
  };
}
function parseWorkflowRunEvent(raw) {
  const o = asRecord(raw);
  const wr = asRecord(o.workflow_run);
  const repository = asRecord(o.repository);
  const repo = typeof repository.full_name === "string" ? repository.full_name : "";
  const headSha = typeof wr.head_sha === "string" ? wr.head_sha : "";
  if (!repo || !headSha) return null;
  return {
    kind: "workflow_run",
    action: typeof o.action === "string" ? o.action : "",
    repo,
    headSha,
    conclusion: typeof wr.conclusion === "string" ? wr.conclusion : null,
    prNumbers: prNumbersFrom(wr.pull_requests),
    name: typeof wr.name === "string" && wr.name ? wr.name : "workflow",
    detailsUrl: typeof wr.html_url === "string" ? wr.html_url : ""
  };
}
function parseCiCompletionEvent(raw, eventType) {
  if (eventType === "check_suite") return parseCheckSuiteEvent(raw);
  if (eventType === "workflow_run") return parseWorkflowRunEvent(raw);
  return null;
}
function isAgentReviewCheck(name) {
  return name.startsWith(AGENT_REVIEW_CHECK_PREFIX);
}
function isFailingCheck(c) {
  return c.conclusion !== null && FAILING_CONCLUSIONS.has(c.conclusion);
}
function ciChecks(checks) {
  return checks.filter((c) => !isAgentReviewCheck(c.name));
}
function failingChecks(checks) {
  return ciChecks(checks).filter(isFailingCheck);
}
function classifyCiState(checks) {
  const ci = ciChecks(checks);
  if (ci.length === 0) return "none";
  if (ci.some(isFailingCheck)) return "failing";
  if (ci.some((c) => c.status !== "completed")) return "pending";
  return "green";
}
function decideCiFixAction(record, state) {
  if (state === "failing") return record && record.status === "open" ? "update" : "create";
  if (state === "green") return record && record.status === "open" ? "close" : "noop";
  return "noop";
}
function ciFixMarker(repo, prNumber) {
  return `<!-- ci-fix: ${repo}#${prNumber} -->`;
}
function shortSha2(sha) {
  return sha.length > 7 ? sha.slice(0, 7) : sha;
}
function truncate(s, max) {
  const t = s.trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "\u2026" : t;
}
function renderFailedChecks(failed) {
  if (failed.length === 0) return "- _(no individual failing check reported)_";
  const shown = failed.slice(0, 20);
  const lines = shown.map((c) => {
    const excerpt = c.summary ? ` \u2014 ${truncate(c.summary.replace(/\s+/g, " "), 160)}` : "";
    const link = c.detailsUrl ? ` ([logs](${c.detailsUrl}))` : "";
    return `- \`${c.name}\`${excerpt}${link}`;
  });
  if (failed.length > shown.length) lines.push(`- \u2026and ${failed.length - shown.length} more`);
  return lines.join("\n");
}
function buildCiFixTitle(ctx) {
  const suffix = ctx.prTitle ? ` \u2014 ${ctx.prTitle}` : "";
  return `CI failing \u2014 ${ctx.repo}#${ctx.prNumber}${suffix}`;
}
function buildCiFixBody(ctx) {
  const runLine = ctx.runUrl ? `${ctx.runName} (${ctx.runUrl})` : ctx.runName;
  return [
    ciFixMarker(ctx.repo, ctx.prNumber),
    "",
    `**PR:** ${ctx.prUrl || `${ctx.repo}#${ctx.prNumber}`}`,
    `**Head SHA:** \`${ctx.headSha}\``,
    `**Failing run:** ${runLine}`,
    `**Owner:** ${ctx.ownerName}`,
    "",
    `### Failing checks (${ctx.failed.length})`,
    renderFailedChecks(ctx.failed),
    "",
    "### What to do",
    "- Reproduce + fix the failure, then push to the PR branch.",
    "- When CI goes green on the new head SHA this issue **auto-closes** (GOL-305).",
    "- If the PR is being abandoned, close this issue `done` \u2014 a green suite would do the same.",
    "",
    "_Opened automatically from a failing CI check on an agent-authored PR (GOL-305)._"
  ].join("\n");
}
function buildCiReFailNote(ctx) {
  return [
    `\u{1F501} CI still failing at head \`${shortSha2(ctx.headSha)}\` (${ctx.runName}).`,
    "",
    `### Failing checks (${ctx.failed.length})`,
    renderFailedChecks(ctx.failed)
  ].join("\n");
}
function buildCiResolvedNote(headSha) {
  return `\u2705 CI is green at head \`${shortSha2(headSha)}\` \u2014 auto-closing this fix issue (GOL-305).`;
}
function buildCiFixOpenedPing(ctx) {
  return `\u{1F6A8} CI failing on ${ctx.repo}#${ctx.prNumber} \u2192 fix issue for ${ctx.ownerName} \u2014 <${ctx.prUrl || ctx.repo}>`;
}
function buildCiFixUpdatedPing(ctx) {
  return `\u{1F501} CI still failing on ${ctx.repo}#${ctx.prNumber} (\`${shortSha2(ctx.headSha)}\`) \u2192 fix issue updated`;
}
function buildCiFixResolvedPing(repo, prNumber) {
  return `\u2705 CI green on ${repo}#${prNumber} \u2192 fix issue auto-closed`;
}

// src/ci-failure-store.ts
var CI_FAILURE_TABLE = "github_ci_failure";
function qualified2(db) {
  return `${db.namespace}.${CI_FAILURE_TABLE}`;
}
function toRow3(raw) {
  return {
    githubRepo: String(raw.github_repo),
    prNumber: Number(raw.pr_number),
    headSha: String(raw.head_sha),
    paperclipIssueId: String(raw.paperclip_issue_id),
    status: raw.status === "closed" ? "closed" : "open",
    updatedAt: String(raw.updated_at)
  };
}
async function getCiFailureRecord(db, githubRepo, prNumber) {
  const rows = await db.query(
    `SELECT github_repo, pr_number, head_sha, paperclip_issue_id, status, updated_at
       FROM ${qualified2(db)}
      WHERE github_repo = $1 AND pr_number = $2`,
    [githubRepo, prNumber]
  );
  const first = rows[0];
  return first ? toRow3(first) : null;
}
async function upsertCiFailureRecord(db, row) {
  await db.execute(
    `INSERT INTO ${qualified2(db)}
       (github_repo, pr_number, head_sha, paperclip_issue_id, status, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (github_repo, pr_number) DO UPDATE SET
       head_sha = $3,
       paperclip_issue_id = $4,
       status = $5,
       updated_at = $6`,
    [row.githubRepo, row.prNumber, row.headSha, row.paperclipIssueId, row.status, row.updatedAt]
  );
}

// src/paperclip-rest.ts
function isScopeExpiryError(err) {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (!msg.includes("invocation scope")) return false;
  return msg.includes("expired") || msg.includes("missing") || msg.includes("unknown");
}
var PaperclipRestError = class extends Error {
  status;
  constructor(message, status) {
    super(message);
    this.name = "PaperclipRestError";
    this.status = status;
  }
};
var PaperclipRestClient = class {
  baseUrl;
  token;
  http;
  cfAccessClientId;
  cfAccessClientSecret;
  constructor(opts) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.token = opts.token;
    this.http = opts.http;
    this.cfAccessClientId = opts.cfAccessClientId;
    this.cfAccessClientSecret = opts.cfAccessClientSecret;
  }
  headers() {
    const h = {
      "content-type": "application/json",
      authorization: "Bearer " + this.token
    };
    if (this.cfAccessClientId && this.cfAccessClientSecret) {
      h["CF-Access-Client-Id"] = this.cfAccessClientId;
      h["CF-Access-Client-Secret"] = this.cfAccessClientSecret;
    }
    return h;
  }
  async assertOk(res, what) {
    if (res.ok) return;
    let snippet = "";
    try {
      snippet = (await res.text()).slice(0, 300);
    } catch {
    }
    throw new PaperclipRestError(
      `Paperclip REST ${what} failed: ${res.status} ${res.statusText} ${snippet}`.trim(),
      res.status
    );
  }
  /**
   * POST /api/companies/{companyId}/issues — mirror of `ctx.issues.create`. `body`
   * is the SAME object passed to ctx.issues.create MINUS `companyId` (which moves
   * into the URL). Returns the created issue JSON (has `id`).
   */
  async createIssue(companyId, body) {
    const url = `${this.baseUrl}/api/companies/${encodeURIComponent(companyId)}/issues`;
    const res = await this.http.fetch(url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body)
    });
    await this.assertOk(res, "createIssue");
    return await res.json();
  }
  /**
   * GET /api/companies/{companyId}/issues — mirror of `ctx.issues.list`.
   *
   * Added for the mirror-reconcile SWEEP (GOL-1163), which is the first caller to
   * need a READ fallback. Scheduled jobs are the sharpest case for scope expiry:
   * unlike a webhook delivery or event dispatch, a cron tick has no ambient
   * invocation scope to inherit, so `ctx.issues.list` can fail outright with
   * "referenced a missing, expired, or unknown invocation scope" — observed
   * 2026-08-03 21:23Z, which silently stopped the twin backfill.
   *
   * The host returns a bare JSON array; a non-array body yields [] rather than a
   * throw, so a shape change degrades the sweep to a no-op instead of erroring
   * the whole job.
   */
  async listIssues(companyId, params = {}) {
    const qs = new URLSearchParams();
    if (params.projectId) qs.set("projectId", params.projectId);
    if (params.status) qs.set("status", params.status);
    if (params.limit !== void 0) qs.set("limit", String(params.limit));
    if (params.offset !== void 0) qs.set("offset", String(params.offset));
    const query = qs.toString();
    const url = `${this.baseUrl}/api/companies/${encodeURIComponent(companyId)}/issues` + (query ? `?${query}` : "");
    const res = await this.http.fetch(url, { method: "GET", headers: this.headers() });
    await this.assertOk(res, "listIssues");
    const body = await res.json();
    return Array.isArray(body) ? body : [];
  }
  /**
   * GET /api/issues/{issueId} — mirror of `ctx.issues.get`. Returns the issue JSON,
   * or null on 404 (matching ctx.issues.get's `Issue | null`).
   */
  async getIssue(issueId) {
    const url = `${this.baseUrl}/api/issues/${encodeURIComponent(issueId)}`;
    const res = await this.http.fetch(url, {
      method: "GET",
      headers: this.headers()
    });
    if (res.status === 404) return null;
    await this.assertOk(res, "getIssue");
    return await res.json();
  }
  /**
   * PATCH /api/issues/{issueId} — mirror of `ctx.issues.update`. `patch` is the
   * same partial passed to ctx.issues.update. Returns the updated issue JSON.
   */
  async updateIssue(issueId, patch) {
    const url = `${this.baseUrl}/api/issues/${encodeURIComponent(issueId)}`;
    const res = await this.http.fetch(url, {
      method: "PATCH",
      headers: this.headers(),
      body: JSON.stringify(patch)
    });
    await this.assertOk(res, "updateIssue");
    return await res.json();
  }
  /**
   * POST /api/issues/{issueId}/comments — mirror of `ctx.issues.createComment`.
   * The API field is `body` (NOT `content`/`comment`); a wrong field name is
   * accepted with a 200 and silently drops the text.
   */
  async createComment(issueId, body) {
    const url = `${this.baseUrl}/api/issues/${encodeURIComponent(issueId)}/comments`;
    const res = await this.http.fetch(url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ body })
    });
    await this.assertOk(res, "createComment");
  }
};
async function withRestFallback(deps, site, fn, restFn) {
  try {
    return await fn();
  } catch (err) {
    const { logger, rest } = deps;
    if (!isScopeExpiryError(err) || !rest) throw err;
    logger.warn("inbound write hit scope-expiry; retrying via Paperclip REST fallback (GOL-323)", { site });
    try {
      const result = await restFn(rest);
      logger.info("Paperclip REST fallback succeeded (GOL-323)", { site });
      return result;
    } catch (restErr) {
      const status = restErr instanceof PaperclipRestError ? restErr.status : void 0;
      const detail = restErr instanceof Error ? restErr.message : String(restErr);
      logger.error("Paperclip REST fallback failed (GOL-323)", { site, status, error: detail });
      if (deps.onFallbackFailure) {
        try {
          await deps.onFallbackFailure({ site, status, detail });
        } catch (hookErr) {
          logger.warn("onFallbackFailure hook threw (ignored)", {
            site,
            error: hookErr instanceof Error ? hookErr.message : String(hookErr)
          });
        }
      }
      throw restErr;
    }
  }
}

// src/worker.ts
var INBOUND_ENDPOINT_KEY = "github-issue";
var APP_WEBHOOK_ENDPOINT_KEY = "github-app";
var PR_WEBHOOK_ENDPOINT_KEY = "github-pr";
var SIGNOFF_RECONCILE_WINDOW_MS = 3 * 24 * 60 * 60 * 1e3;
var SIGNOFF_RECONCILE_ROW_CAP = 200;
var INBOUND_CLOSE_RECONCILE_WINDOW_MS = 14 * 24 * 60 * 60 * 1e3;
var INBOUND_CLOSE_RECONCILE_MAX_PAGES = 5;
var INBOUND_CREATE_RECONCILE_WINDOW_MS = 14 * 24 * 60 * 60 * 1e3;
var INBOUND_CREATE_RECONCILE_MAX_PAGES = 5;
var currentContext = null;
function safeJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
var PRIORITIES = ["critical", "high", "medium", "low"];
function readConfig(raw) {
  const rawBridges = Array.isArray(raw.bridges) ? raw.bridges : [];
  const bridges = rawBridges.map((b) => {
    const o = b ?? {};
    const rawPriority = typeof o.defaultPriority === "string" ? o.defaultPriority.toLowerCase() : "";
    const defaultAssigneeAgentId = o.defaultAssigneeAgentId ? String(o.defaultAssigneeAgentId) : void 0;
    const fallbackAssigneeAgentId = o.fallbackAssigneeAgentId ? String(o.fallbackAssigneeAgentId) : void 0;
    const labelRouting = o.labelRouting && typeof o.labelRouting === "object" && !Array.isArray(o.labelRouting) ? Object.fromEntries(
      Object.entries(o.labelRouting).filter(([, v]) => typeof v === "string" && v).map(([k, v]) => [k, String(v)])
    ) : void 0;
    return {
      githubOrg: String(o.githubOrg ?? "EngineeringMoonBear"),
      githubRepo: String(o.githubRepo ?? ""),
      paperclipProjectId: String(o.paperclipProjectId ?? ""),
      syncLabelPaperclip: String(o.syncLabelPaperclip ?? "synced-from-paperclip"),
      syncMarkerGithub: String(o.syncMarkerGithub ?? "synced-from-github"),
      defaultAssigneeAgentId,
      fallbackAssigneeAgentId,
      ...labelRouting && Object.keys(labelRouting).length > 0 ? { labelRouting } : {},
      // Invalid/absent priority silently falls back to "medium" at create time.
      defaultPriority: PRIORITIES.includes(rawPriority) ? rawPriority : void 0
    };
  }).filter((b) => b.githubRepo && b.paperclipProjectId);
  return {
    bridges,
    tokenBrokerUrl: raw.tokenBrokerUrl ? String(raw.tokenBrokerUrl) : void 0,
    tokenBrokerApiKey: raw.tokenBrokerApiKey ? String(raw.tokenBrokerApiKey) : void 0,
    githubToken: raw.githubToken ? String(raw.githubToken) : void 0,
    companyId: raw.companyId ? String(raw.companyId) : void 0,
    inboundWebhookSecret: raw.inboundWebhookSecret ? String(raw.inboundWebhookSecret) : void 0,
    appWebhookSecret: raw.appWebhookSecret ? String(raw.appWebhookSecret) : void 0,
    opsWebhookUrl: raw.opsWebhookUrl ? String(raw.opsWebhookUrl) : void 0,
    opsPingMode: raw.opsPingMode === "verbose" || raw.opsPingMode === "errors" || raw.opsPingMode === "outcomes" ? raw.opsPingMode : void 0,
    prReviewAliceAgentId: raw.prReviewAliceAgentId ? String(raw.prReviewAliceAgentId) : void 0,
    prReviewIrisAgentId: raw.prReviewIrisAgentId ? String(raw.prReviewIrisAgentId) : void 0,
    prReviewFrontendPaths: Array.isArray(raw.prReviewFrontendPaths) ? raw.prReviewFrontendPaths.filter((p) => typeof p === "string" && p.length > 0) : void 0,
    ciAgentPrAuthor: raw.ciAgentPrAuthor ? String(raw.ciAgentPrAuthor) : void 0,
    paperclipApiBaseUrl: raw.paperclipApiBaseUrl ? String(raw.paperclipApiBaseUrl) : void 0,
    paperclipApiToken: raw.paperclipApiToken ? String(raw.paperclipApiToken) : void 0,
    paperclipCfAccessClientId: raw.paperclipCfAccessClientId ? String(raw.paperclipCfAccessClientId) : void 0,
    paperclipCfAccessClientSecret: raw.paperclipCfAccessClientSecret ? String(raw.paperclipCfAccessClientSecret) : void 0
  };
}
function restFallbackClient(ctx, cfg) {
  if (!cfg.paperclipApiBaseUrl || !cfg.paperclipApiToken) return null;
  return new PaperclipRestClient({
    baseUrl: cfg.paperclipApiBaseUrl,
    token: cfg.paperclipApiToken,
    http: ctx.http,
    cfAccessClientId: cfg.paperclipCfAccessClientId,
    cfAccessClientSecret: cfg.paperclipCfAccessClientSecret
  });
}
function restFallbackDeps(ctx, cfg) {
  return {
    logger: ctx.logger,
    rest: restFallbackClient(ctx, cfg),
    // GOL-1485: every fallback path routes through here, so wiring the observability hook
    // once covers mirror.create, sync.get, reconcile.list, ci.*, close, etc. uniformly.
    onFallbackFailure: ({ site, status }) => recordFallbackFailure(ctx, cfg, site, status)
  };
}
async function recordFallbackFailure(ctx, cfg, site, status) {
  const code = status === void 0 ? "no HTTP status" : `HTTP ${status}`;
  try {
    await recordError(ctx.db, {
      occurredAt: (/* @__PURE__ */ new Date()).toISOString(),
      scope: "rest-fallback-failed",
      detail: `Paperclip REST fallback failed for ${site} (${code})`,
      context: { site, status }
    });
  } catch (writeErr) {
    ctx.logger.warn("failed to persist rest-fallback failure to github_sync_error", {
      site,
      error: writeErr instanceof Error ? writeErr.message : String(writeErr)
    });
  }
  await postThrottledOpsAlert(ctx, cfg, buildFallbackFailurePing(site, status));
}
var opsAlertThrottle = new OpsPingThrottle();
async function postThrottledOpsAlert(ctx, cfg, content) {
  const decision = opsAlertThrottle.decide(content, Date.now());
  if (!decision.emit) return;
  await postOpsPing(ctx, cfg.opsWebhookUrl, withSuppressionNote(content, decision.suppressed));
}
function wantPing(cfg, klass) {
  const mode = cfg.opsPingMode ?? "outcomes";
  if (klass === "error") return true;
  if (mode === "verbose") return true;
  if (mode === "outcomes") return klass === "outcome";
  return false;
}
async function postOpsPing(ctx, webhookUrl, content) {
  if (!webhookUrl) return;
  try {
    const res = await ctx.http.fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content })
    });
    if (!res.ok) {
      ctx.logger.warn("ops webhook ping failed", { status: res.status });
    }
  } catch (err) {
    if (isNullBodyStatusError(err)) return;
    ctx.logger.warn("ops webhook ping error", {
      error: err instanceof Error ? err.message : String(err)
    });
  }
}
async function recordSwallowedFailure(ctx, cfg, scope, err, context = {}) {
  const detail = err instanceof Error ? err.message : String(err);
  ctx.logger.error(scope, { ...context, error: detail });
  try {
    await recordError(ctx.db, {
      occurredAt: (/* @__PURE__ */ new Date()).toISOString(),
      scope,
      detail,
      context
    });
  } catch (writeErr) {
    ctx.logger.warn("failed to persist swallowed failure to github_sync_error", {
      error: writeErr instanceof Error ? writeErr.message : String(writeErr)
    });
  }
  await postThrottledOpsAlert(ctx, cfg, buildSwallowedFailurePing(scope, detail));
}
async function recordPipelineError(ctx, cfg, scope, detail, context = {}) {
  ctx.logger.warn(scope, { ...context, detail });
  try {
    await recordError(ctx.db, {
      occurredAt: (/* @__PURE__ */ new Date()).toISOString(),
      scope,
      detail,
      context
    });
  } catch (writeErr) {
    ctx.logger.warn("failed to persist pipeline error to github_sync_error", {
      error: writeErr instanceof Error ? writeErr.message : String(writeErr)
    });
  }
  await postThrottledOpsAlert(ctx, cfg, buildPipelineErrorPing(detail));
}
async function safeRecordDelivery(ctx, input, outcome, detail) {
  try {
    await recordDelivery(ctx.db, {
      requestId: input.requestId,
      endpointKey: input.endpointKey,
      event: getHeader(input.headers, "x-github-event") ?? null,
      deliveryGuid: getHeader(input.headers, "x-github-delivery") ?? null,
      outcome,
      detail: detail ?? null,
      occurredAt: (/* @__PURE__ */ new Date()).toISOString()
    });
  } catch (err) {
    ctx.logger.warn("failed to persist webhook delivery outcome", {
      endpointKey: input.endpointKey,
      outcome,
      error: err instanceof Error ? err.message : String(err)
    });
  }
}
function makeDispatch(ctx, cfg, depsByProject, handle, eventName) {
  return async (event) => {
    try {
      if (!event.entityId) {
        ctx.logger.warn(`${eventName} event missing entityId; skipping`);
        return;
      }
      const issue = await withRestFallback(
        restFallbackDeps(ctx, cfg),
        `${eventName}.get`,
        () => ctx.issues.get(event.entityId, event.companyId),
        async (rest) => await rest.getIssue(event.entityId)
      );
      if (!issue) {
        ctx.logger.warn(`${eventName}: issue not readable; skipping`, {
          issueId: event.entityId
        });
        return;
      }
      const deps = issue.projectId ? depsByProject.get(issue.projectId) : void 0;
      if (!deps) return;
      await handle(deps, { issueId: event.entityId, companyId: event.companyId });
    } catch (err) {
      await recordSwallowedFailure(ctx, cfg, `${eventName} handler failed`, err, {
        issueId: event.entityId
      });
    }
  };
}
function matchBridge(cfg, repo) {
  return cfg.bridges.find(
    (b) => `${b.githubOrg}/${b.githubRepo}`.toLowerCase() === repo.toLowerCase() || b.githubRepo.toLowerCase() === repo.toLowerCase()
  );
}
async function createMirrorIssue(ctx, cfg, bridge, payload, labels = [], runInScope = (fn) => fn()) {
  if (!cfg.companyId) {
    ctx.logger.error("inbound webhook: companyId not configured \u2014 cannot create issue");
    return;
  }
  const existing = await getByRepoNumber(ctx.db, payload.repo, payload.number);
  if (existing) {
    ctx.logger.info("inbound webhook: already mirrored; skipping", {
      repo: payload.repo,
      number: payload.number
    });
    return;
  }
  const routing = resolveRouting(bridge, labels);
  const assigneeAgentId = routing.assigneeAgentId;
  const createInput = {
    companyId: cfg.companyId,
    projectId: bridge.paperclipProjectId,
    title: payload.title,
    description: buildInboundDescription(payload),
    status: "todo",
    priority: bridge.defaultPriority ?? "medium",
    ...assigneeAgentId ? { assigneeAgentId } : {}
  };
  const issue = await withRestFallback(
    restFallbackDeps(ctx, cfg),
    "mirror.create",
    () => runInScope(() => ctx.issues.create(createInput)),
    // companyId moves into the URL for the REST create; pass the rest of the payload.
    (rest) => {
      const { companyId: _companyId, ...restBody } = createInput;
      return rest.createIssue(cfg.companyId, restBody);
    }
  );
  await upsert(ctx.db, {
    paperclipIssueId: issue.id,
    githubRepo: payload.repo,
    githubIssueNumber: payload.number,
    lastSyncedAt: (/* @__PURE__ */ new Date()).toISOString(),
    origin: "github"
  });
  ctx.logger.info("inbound: created Paperclip issue from GitHub", {
    repo: payload.repo,
    number: payload.number,
    projectId: bridge.paperclipProjectId,
    issueId: issue.id,
    assigneeAgentId: assigneeAgentId ?? null,
    routing: routing.reason,
    routedByLabel: routing.matchedLabel ?? null
  });
  if (!assigneeAgentId) {
    ctx.logger.warn(
      "inbound: mirror created UNASSIGNED \u2014 configure the bridge's labelRouting/fallbackAssigneeAgentId (or defaultAssigneeAgentId) so it enters an agent heartbeat",
      { repo: payload.repo, number: payload.number, projectId: bridge.paperclipProjectId }
    );
  }
  if (!wantPing(cfg, assigneeAgentId ? "lifecycle" : "error")) return;
  await postOpsPing(
    ctx,
    cfg.opsWebhookUrl,
    buildMirrorOpsMessage({
      repo: payload.repo,
      number: payload.number,
      title: payload.title,
      url: payload.url,
      projectId: bridge.paperclipProjectId,
      issueId: issue.id,
      assigneeAgentId,
      routedByLabel: routing.matchedLabel,
      routedByFallback: routing.reason === "fallback" || routing.reason === "default"
    })
  );
}
async function handleCustomInbound(ctx, cfg, input, runInScope) {
  if (!cfg.inboundWebhookSecret) {
    throw new WebhookRejection("rejected_config", "inbound webhook: no inboundWebhookSecret configured");
  }
  if (!verifyGithubSignature(input.rawBody, cfg.inboundWebhookSecret, getHeader(input.headers, "x-hub-signature-256"))) {
    throw new WebhookRejection("rejected_signature", "inbound webhook: signature verification failed");
  }
  const payload = parseInboundPayload(input.parsedBody ?? safeJson(input.rawBody));
  if (!payload) {
    throw new WebhookRejection("invalid_payload", "inbound webhook: unparseable/invalid payload");
  }
  const bridge = matchBridge(cfg, payload.repo);
  if (!bridge) {
    ctx.logger.info("inbound webhook: repo not in a synced bridge; ignoring", { repo: payload.repo });
    return;
  }
  await createMirrorIssue(ctx, cfg, bridge, payload, [], runInScope);
}
async function handleAppClosure(ctx, cfg, event, runInScope) {
  const bridge = matchBridge(cfg, event.payload.repo);
  if (!bridge) {
    ctx.logger.info("app webhook: closure for repo not in a synced bridge; ignoring", {
      repo: event.payload.repo
    });
    return "no-bridge";
  }
  if (!cfg.companyId) {
    ctx.logger.error("app webhook: companyId not configured \u2014 cannot propagate closure");
    return "no-company";
  }
  const mapping = await getByRepoNumber(ctx.db, event.payload.repo, event.payload.number);
  if (!mapping) {
    ctx.logger.info("app webhook: closure for unmapped issue; nothing to propagate", {
      repo: event.payload.repo,
      number: event.payload.number,
      action: event.action
    });
    return "unmapped";
  }
  const issue = await withRestFallback(
    restFallbackDeps(ctx, cfg),
    "closure.get",
    () => runInScope(() => ctx.issues.get(mapping.paperclipIssueId, cfg.companyId)),
    async (rest) => await rest.getIssue(mapping.paperclipIssueId)
  );
  if (!issue) {
    const deleted = await deleteByPaperclipIssueId(ctx.db, mapping.paperclipIssueId);
    ctx.logger.info("app webhook: mirror issue gone; pruned orphaned mapping (self-heal)", {
      issueId: mapping.paperclipIssueId,
      repo: event.payload.repo,
      number: event.payload.number,
      action: event.action,
      rowsDeleted: deleted
    });
    return "pruned";
  }
  const target = resolveMirrorClosureStatus(event.action, issue.status);
  if (!target) {
    ctx.logger.info("app webhook: mirror already in sync; skipping (loop guard)", {
      issueId: issue.id,
      action: event.action,
      status: issue.status
    });
    return "in-sync";
  }
  await withRestFallback(
    restFallbackDeps(ctx, cfg),
    "closure.update",
    async () => {
      await runInScope(() => ctx.issues.update(issue.id, { status: target }, cfg.companyId));
    },
    async (rest) => {
      await rest.updateIssue(issue.id, { status: target });
    }
  );
  await upsert(ctx.db, { ...mapping, lastSyncedAt: (/* @__PURE__ */ new Date()).toISOString() });
  ctx.logger.info("app webhook: propagated GitHub closure to Paperclip mirror", {
    issueId: issue.id,
    repo: event.payload.repo,
    number: event.payload.number,
    action: event.action,
    status: target
  });
  return "propagated";
}
async function handleAppInbound(ctx, cfg, input, runInScope) {
  if (!cfg.appWebhookSecret) {
    throw new WebhookRejection("rejected_config", "app webhook: no appWebhookSecret configured");
  }
  if (!verifyGithubSignature(input.rawBody, cfg.appWebhookSecret, getHeader(input.headers, "x-hub-signature-256"))) {
    throw new WebhookRejection("rejected_signature", "app webhook: signature verification failed");
  }
  const eventType = getHeader(input.headers, "x-github-event");
  if (eventType && eventType !== "issues") {
    ctx.logger.info("app webhook: ignoring non-issues event", { eventType });
    return;
  }
  const event = parseGithubAppIssueEvent(input.parsedBody ?? safeJson(input.rawBody));
  if (!event) {
    ctx.logger.warn("app webhook: unparseable/invalid issues payload");
    return;
  }
  if (event.action === "closed" || event.action === "reopened") {
    await handleAppClosure(ctx, cfg, event, runInScope);
    return;
  }
  if (event.action !== "opened") {
    ctx.logger.info("app webhook: ignoring issue action", { action: event.action });
    return;
  }
  const bridge = matchBridge(cfg, event.payload.repo);
  if (!bridge) {
    ctx.logger.info("app webhook: repo not in a synced bridge; ignoring", { repo: event.payload.repo });
    return;
  }
  if (event.labels.some((l) => l.toLowerCase() === bridge.syncLabelPaperclip.toLowerCase())) {
    ctx.logger.info("app webhook: issue is Paperclip-origin (label); skipping", {
      repo: event.payload.repo,
      number: event.payload.number
    });
    return;
  }
  await createMirrorIssue(ctx, cfg, bridge, event.payload, event.labels, runInScope);
}
function makeBridgeGithubClient(cfg, bridge) {
  const brokerUrl = cfg.tokenBrokerUrl || process.env.GH_TOKEN_BROKER_URL || "";
  if (brokerUrl) {
    return new GitHubClient({
      org: bridge.githubOrg,
      getToken: makeBrokerTokenProvider(brokerUrl, bridge.githubOrg, { apiKey: cfg.tokenBrokerApiKey })
    });
  }
  if (cfg.githubToken) {
    return new GitHubClient({ org: bridge.githubOrg, getToken: staticTokenProvider(cfg.githubToken) });
  }
  return null;
}
function captureInvocationScope() {
  return AsyncResource.bind((fn) => fn());
}
async function handlePrInbound(ctx, cfg, input) {
  if (!cfg.appWebhookSecret) {
    throw new WebhookRejection("rejected_config", "pr webhook: no appWebhookSecret configured");
  }
  if (!verifyGithubSignature(input.rawBody, cfg.appWebhookSecret, getHeader(input.headers, "x-hub-signature-256"))) {
    throw new WebhookRejection("rejected_signature", "pr webhook: signature verification failed");
  }
  const eventType = getHeader(input.headers, "x-github-event");
  if (eventType && eventType !== "pull_request") {
    ctx.logger.info("pr webhook: ignoring non-pull_request event", { eventType });
    return;
  }
  const ev = parseGithubPrEvent(input.parsedBody ?? safeJson(input.rawBody));
  if (!ev) {
    ctx.logger.warn("pr webhook: unparseable/invalid pull_request payload");
    return;
  }
  if (ev.draft) {
    ctx.logger.info("pr webhook: skipping draft PR", { repo: ev.repo, number: ev.number });
    return;
  }
  if (!isActionablePrAction(ev.action)) {
    ctx.logger.info("pr webhook: ignoring PR action", { action: ev.action, repo: ev.repo, number: ev.number });
    return;
  }
  const bridge = matchBridge(cfg, ev.repo);
  if (!bridge) {
    ctx.logger.info("pr webhook: repo not in a synced bridge; ignoring", { repo: ev.repo });
    return;
  }
  if (!cfg.companyId) {
    ctx.logger.error("pr webhook: companyId not configured \u2014 cannot create review issues");
    return;
  }
  if (!cfg.prReviewAliceAgentId) {
    ctx.logger.info("pr webhook: PR review pipeline disabled (no prReviewAliceAgentId configured)");
    return;
  }
  const github = makeBridgeGithubClient(cfg, bridge);
  if (!github) {
    ctx.logger.warn("pr webhook: no auth for bridge \u2014 cannot fetch PR files", { repo: ev.repo });
    return;
  }
  if (ev.action === "synchronize") {
    const headSha = ev.after || ev.headSha;
    const commitRes = await github.getCommit(bridge.githubRepo, headSha);
    if (!commitRes.ok) {
      ctx.logger.warn("pr webhook: head commit fetch failed \u2014 treating as author work", {
        repo: ev.repo,
        number: ev.number,
        headSha,
        error: commitRes.error
      });
    }
    const kind = classifyHeadChange({
      before: ev.before,
      head: commitRes.ok ? { parents: commitRes.data.parents, committerLogin: commitRes.data.committerLogin } : null
    });
    if (kind === "base-sync") {
      ctx.logger.info("pr webhook: base-sync (Update branch) \u2014 skipping re-review", {
        repo: ev.repo,
        number: ev.number,
        before: ev.before,
        after: headSha
      });
      return;
    }
  }
  const runInScope = captureInvocationScope();
  const filesRes = await github.listPullFiles(bridge.githubRepo, ev.number);
  if (!filesRes.ok) {
    await recordSwallowedFailure(
      ctx,
      cfg,
      "pr webhook: failed to fetch PR changed files",
      filesRes.error,
      { repo: ev.repo, number: ev.number }
    );
    return;
  }
  const { files, truncated } = filesRes.data;
  if (truncated) {
    ctx.logger.warn("pr webhook: changed-file list truncated at the page cap \u2014 frontend match may under-report", {
      repo: ev.repo,
      number: ev.number
    });
  }
  const frontendPaths = cfg.prReviewFrontendPaths?.length ? cfg.prReviewFrontendPaths : DEFAULT_FRONTEND_PATHS;
  const isFrontend = anyFrontendMatch(files, frontendPaths);
  const reviewers = [
    { reviewer: "ada", agentId: cfg.prReviewAliceAgentId }
  ];
  if (isFrontend && cfg.prReviewIrisAgentId) {
    reviewers.push({ reviewer: "iris", agentId: cfg.prReviewIrisAgentId });
  }
  const created = [];
  const reopened = [];
  for (const { reviewer, agentId } of reviewers) {
    try {
      const outcome = await processReviewer(ctx, cfg, bridge, github, ev, files, reviewer, agentId, runInScope);
      if (outcome === "created") created.push(reviewer);
      else if (outcome === "reopened") reopened.push(reviewer);
    } catch (err) {
      await recordSwallowedFailure(ctx, cfg, "pr webhook: reviewer processing failed", err, {
        repo: ev.repo,
        number: ev.number,
        reviewer
      });
    }
  }
  if (created.length && wantPing(cfg, "lifecycle")) {
    await postOpsPing(ctx, cfg.opsWebhookUrl, buildReviewIssuesCreatedPing(ev, created));
  }
  if (reopened.length && wantPing(cfg, "lifecycle")) {
    await postOpsPing(ctx, cfg.opsWebhookUrl, buildReReviewPing(ev, reopened));
  }
}
async function processReviewer(ctx, cfg, bridge, github, ev, files, reviewer, agentId, runInScope) {
  const existing = await getReviewRecord(ctx.db, ev.repo, ev.number, reviewer);
  const action = decideReviewAction(existing ? existing.headSha : null, ev.headSha);
  if (action === "noop") {
    ctx.logger.info("pr webhook: already reviewed at this head SHA; skipping", {
      repo: ev.repo,
      number: ev.number,
      reviewer,
      headSha: ev.headSha
    });
    return "noop";
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  if (action === "create" || !existing) {
    const createInput = {
      companyId: cfg.companyId,
      projectId: bridge.paperclipProjectId,
      title: buildReviewIssueTitle(reviewer, ev),
      description: buildReviewIssueBody(reviewer, ev, files),
      status: "todo",
      priority: bridge.defaultPriority ?? "medium",
      assigneeAgentId: agentId
    };
    const issue = await withRestFallback(
      restFallbackDeps(ctx, cfg),
      "review.create",
      () => runInScope(() => ctx.issues.create(createInput)),
      (rest) => {
        const { companyId: _companyId, ...restBody } = createInput;
        return rest.createIssue(cfg.companyId, restBody);
      }
    );
    await upsertReviewRecord(ctx.db, {
      githubRepo: ev.repo,
      prNumber: ev.number,
      reviewer,
      headSha: ev.headSha,
      paperclipIssueId: issue.id,
      updatedAt: now
    });
    ctx.logger.info("pr webhook: created review issue", {
      repo: ev.repo,
      number: ev.number,
      reviewer,
      issueId: issue.id,
      assigneeAgentId: agentId
    });
    await seedPendingCheck(ctx, github, bridge, ev, reviewer);
    return "created";
  }
  const deps = restFallbackDeps(ctx, cfg);
  await withRestFallback(
    deps,
    "review.update",
    async () => {
      await runInScope(() => ctx.issues.update(existing.paperclipIssueId, { status: "todo" }, cfg.companyId));
    },
    async (rest) => {
      await rest.updateIssue(existing.paperclipIssueId, { status: "todo" });
    }
  );
  const newCommitsNote = buildNewCommitsNote(reviewer, ev);
  await withRestFallback(
    deps,
    "review.comment",
    async () => {
      await runInScope(() => ctx.issues.createComment(existing.paperclipIssueId, newCommitsNote, cfg.companyId));
    },
    (rest) => rest.createComment(existing.paperclipIssueId, newCommitsNote)
  );
  await upsertReviewRecord(ctx.db, {
    githubRepo: ev.repo,
    prNumber: ev.number,
    reviewer,
    headSha: ev.headSha,
    paperclipIssueId: existing.paperclipIssueId,
    updatedAt: now
  });
  ctx.logger.info("pr webhook: reopened review issue for new commits", {
    repo: ev.repo,
    number: ev.number,
    reviewer,
    issueId: existing.paperclipIssueId,
    headSha: ev.headSha
  });
  await seedPendingCheck(ctx, github, bridge, ev, reviewer);
  return "reopened";
}
async function seedPendingCheck(ctx, github, bridge, ev, reviewer) {
  const res = await github.createCheckRun(bridge.githubRepo, {
    name: CHECK_CONTEXT[reviewer],
    headSha: ev.headSha,
    title: `Agent review pending (${reviewer})`,
    summary: `Awaiting ${reviewer}'s review of ${ev.repo}#${ev.number} @ \`${shortSha(ev.headSha)}\`. Non-required during Phase 2 soak (GOL-158).`,
    detailsUrl: ev.url || void 0
  });
  if (!res.ok) {
    ctx.logger.warn("pr webhook: pending check-run seed failed (needs App checks:write?)", {
      repo: ev.repo,
      number: ev.number,
      reviewer,
      status: res.status,
      error: res.error
    });
  }
}
async function handleCiCompletion(ctx, cfg, input, eventType) {
  if (!cfg.appWebhookSecret) {
    throw new WebhookRejection("rejected_config", "ci webhook: no appWebhookSecret configured");
  }
  if (!verifyGithubSignature(input.rawBody, cfg.appWebhookSecret, getHeader(input.headers, "x-hub-signature-256"))) {
    throw new WebhookRejection("rejected_signature", `ci webhook: signature verification failed (${eventType})`);
  }
  const ev = parseCiCompletionEvent(input.parsedBody ?? safeJson(input.rawBody), eventType);
  if (!ev) {
    ctx.logger.warn("ci webhook: unparseable/invalid payload", { eventType });
    return;
  }
  if (ev.action !== "completed") {
    ctx.logger.info("ci webhook: ignoring non-completed action", { action: ev.action, eventType });
    return;
  }
  if (ev.prNumbers.length === 0) {
    ctx.logger.info("ci webhook: run not associated with a PR; ignoring", {
      repo: ev.repo,
      headSha: ev.headSha,
      eventType
    });
    return;
  }
  const bridge = matchBridge(cfg, ev.repo);
  if (!bridge) {
    ctx.logger.info("ci webhook: repo not in a synced bridge; ignoring", { repo: ev.repo });
    return;
  }
  if (!cfg.companyId) {
    ctx.logger.error("ci webhook: companyId not configured \u2014 cannot manage fix issues");
    return;
  }
  if (!cfg.prReviewAliceAgentId) {
    ctx.logger.info("ci webhook: CI-fix loop disabled (no prReviewAliceAgentId configured)");
    return;
  }
  const github = makeBridgeGithubClient(cfg, bridge);
  if (!github) {
    ctx.logger.warn("ci webhook: no auth for bridge \u2014 cannot manage fix issues", { repo: ev.repo });
    return;
  }
  const runInScope = captureInvocationScope();
  for (const prNumber of ev.prNumbers) {
    try {
      await processCiPr(ctx, cfg, bridge, github, ev, prNumber, runInScope);
    } catch (err) {
      await recordPipelineError(
        ctx,
        cfg,
        "ci webhook: PR processing failed",
        `CI-fix handling failed for ${ev.repo}#${prNumber}`,
        { repo: ev.repo, prNumber, error: err instanceof Error ? err.message : String(err) }
      );
    }
  }
}
async function processCiPr(ctx, cfg, bridge, github, ev, prNumber, runInScope) {
  const checksRes = await github.listCommitCheckRuns(bridge.githubRepo, ev.headSha);
  if (!checksRes.ok) {
    await recordPipelineError(
      ctx,
      cfg,
      "ci webhook: failed to list check-runs",
      `could not list check-runs for ${ev.repo}@${ev.headSha}: ${checksRes.error}`,
      { repo: ev.repo, prNumber, headSha: ev.headSha, error: checksRes.error }
    );
    return;
  }
  const state = classifyCiState(checksRes.data);
  const record = await getCiFailureRecord(ctx.db, ev.repo, prNumber);
  const action = decideCiFixAction(record, state);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  if (action === "noop") {
    ctx.logger.info("ci webhook: no action", {
      repo: ev.repo,
      prNumber,
      state,
      record: record?.status ?? null
    });
    return;
  }
  if (action === "close") {
    const rec2 = record;
    const closeDeps = restFallbackDeps(ctx, cfg);
    await withRestFallback(
      closeDeps,
      "ci.close.update",
      async () => {
        await runInScope(() => ctx.issues.update(rec2.paperclipIssueId, { status: "done" }, cfg.companyId));
      },
      async (rest) => {
        await rest.updateIssue(rec2.paperclipIssueId, { status: "done" });
      }
    );
    const resolvedNote = buildCiResolvedNote(ev.headSha);
    await withRestFallback(
      closeDeps,
      "ci.close.comment",
      async () => {
        await runInScope(() => ctx.issues.createComment(rec2.paperclipIssueId, resolvedNote, cfg.companyId));
      },
      (rest) => rest.createComment(rec2.paperclipIssueId, resolvedNote)
    );
    await upsertCiFailureRecord(ctx.db, { ...rec2, headSha: ev.headSha, status: "closed", updatedAt: now });
    ctx.logger.info("ci webhook: auto-closed fix issue (CI green)", {
      repo: ev.repo,
      prNumber,
      issueId: rec2.paperclipIssueId,
      headSha: ev.headSha
    });
    if (wantPing(cfg, "outcome")) await postOpsPing(ctx, cfg.opsWebhookUrl, buildCiFixResolvedPing(ev.repo, prNumber));
    return;
  }
  const prRes = await github.getPull(bridge.githubRepo, prNumber);
  if (!prRes.ok) {
    ctx.logger.error("ci webhook: failed to fetch PR", { repo: ev.repo, prNumber, error: prRes.error });
    return;
  }
  const pr = prRes.data;
  const agentAuthor = cfg.ciAgentPrAuthor || DEFAULT_AGENT_PR_AUTHOR;
  if (pr.authorLogin.toLowerCase() !== agentAuthor.toLowerCase()) {
    ctx.logger.info("ci webhook: PR not agent-authored; skipping", {
      repo: ev.repo,
      prNumber,
      author: pr.authorLogin
    });
    return;
  }
  if (pr.state === "closed") {
    ctx.logger.info("ci webhook: PR is closed; not opening a fix issue", {
      repo: ev.repo,
      prNumber,
      merged: pr.merged
    });
    return;
  }
  const filesRes = await github.listPullFiles(bridge.githubRepo, prNumber);
  const files = filesRes.ok ? filesRes.data.files : [];
  if (!filesRes.ok) {
    ctx.logger.warn("ci webhook: could not list PR files for owner routing; defaulting to Ada", {
      repo: ev.repo,
      prNumber,
      error: filesRes.error
    });
  }
  const frontendPaths = cfg.prReviewFrontendPaths?.length ? cfg.prReviewFrontendPaths : DEFAULT_FRONTEND_PATHS;
  const owner = files.length > 0 && anyFrontendMatch(files, frontendPaths) && cfg.prReviewIrisAgentId ? { agentId: cfg.prReviewIrisAgentId, name: "Iris" } : { agentId: cfg.prReviewAliceAgentId, name: "Ada" };
  const failed = failingChecks(checksRes.data);
  const fixCtx = {
    repo: ev.repo,
    prNumber,
    prUrl: pr.htmlUrl || ev.detailsUrl,
    prTitle: pr.title,
    headSha: ev.headSha,
    ownerName: owner.name,
    runName: ev.name,
    runUrl: ev.detailsUrl,
    failed
  };
  if (action === "create") {
    const createInput = {
      companyId: cfg.companyId,
      projectId: bridge.paperclipProjectId,
      title: buildCiFixTitle(fixCtx),
      description: buildCiFixBody(fixCtx),
      status: "todo",
      // CI red blocks the merge — fix issues page higher than routine mirrors.
      priority: bridge.defaultPriority ?? "high",
      assigneeAgentId: owner.agentId
    };
    const issue = await withRestFallback(
      restFallbackDeps(ctx, cfg),
      "ci.create",
      () => runInScope(() => ctx.issues.create(createInput)),
      (rest) => {
        const { companyId: _companyId, ...restBody } = createInput;
        return rest.createIssue(cfg.companyId, restBody);
      }
    );
    await upsertCiFailureRecord(ctx.db, {
      githubRepo: ev.repo,
      prNumber,
      headSha: ev.headSha,
      paperclipIssueId: issue.id,
      status: "open",
      updatedAt: now
    });
    ctx.logger.info("ci webhook: opened CI fix issue", {
      repo: ev.repo,
      prNumber,
      issueId: issue.id,
      assigneeAgentId: owner.agentId,
      failedCount: failed.length
    });
    if (wantPing(cfg, "outcome")) await postOpsPing(ctx, cfg.opsWebhookUrl, buildCiFixOpenedPing(fixCtx));
    return;
  }
  const rec = record;
  const updateDeps = restFallbackDeps(ctx, cfg);
  await withRestFallback(
    updateDeps,
    "ci.update",
    async () => {
      await runInScope(() => ctx.issues.update(rec.paperclipIssueId, { status: "todo" }, cfg.companyId));
    },
    async (rest) => {
      await rest.updateIssue(rec.paperclipIssueId, { status: "todo" });
    }
  );
  const reFailNote = buildCiReFailNote(fixCtx);
  await withRestFallback(
    updateDeps,
    "ci.comment",
    async () => {
      await runInScope(() => ctx.issues.createComment(rec.paperclipIssueId, reFailNote, cfg.companyId));
    },
    (rest) => rest.createComment(rec.paperclipIssueId, reFailNote)
  );
  await upsertCiFailureRecord(ctx.db, { ...rec, headSha: ev.headSha, status: "open", updatedAt: now });
  ctx.logger.info("ci webhook: updated CI fix issue (still failing)", {
    repo: ev.repo,
    prNumber,
    issueId: rec.paperclipIssueId,
    headSha: ev.headSha,
    failedCount: failed.length
  });
  if (wantPing(cfg, "outcome")) await postOpsPing(ctx, cfg.opsWebhookUrl, buildCiFixUpdatedPing(fixCtx));
}
var plugin = definePlugin({
  async setup(ctx) {
    ctx.logger.info("GitHub Sync plugin starting");
    currentContext = ctx;
    const cfg = readConfig(await ctx.config.get());
    if (cfg.bridges.length === 0) {
      ctx.logger.warn(
        "no bridges configured \u2014 GitHub Sync is INACTIVE. Set config.bridges = [{ githubOrg, githubRepo, paperclipProjectId }]. The plugin refuses to mirror company-wide."
      );
      return;
    }
    const brokerUrl = cfg.tokenBrokerUrl || process.env.GH_TOKEN_BROKER_URL || "";
    const depsByProject = /* @__PURE__ */ new Map();
    const clientsBySlug = /* @__PURE__ */ new Map();
    const bridgeSlugsByProject = /* @__PURE__ */ new Map();
    const resolveRepoClient = (repoSlug) => clientsBySlug.get(repoSlug.toLowerCase()) ?? null;
    for (const bridge of cfg.bridges) {
      let getToken;
      if (brokerUrl) {
        getToken = makeBrokerTokenProvider(brokerUrl, bridge.githubOrg, { apiKey: cfg.tokenBrokerApiKey });
      } else if (cfg.githubToken) {
        getToken = staticTokenProvider(cfg.githubToken);
      } else {
        ctx.logger.warn(
          `bridge ${bridge.githubOrg}/${bridge.githubRepo} has no auth (no GH_TOKEN_BROKER_URL / tokenBrokerUrl and no githubToken) \u2014 skipping`
        );
        continue;
      }
      const github = new GitHubClient({ org: bridge.githubOrg, getToken });
      const slug = `${bridge.githubOrg}/${bridge.githubRepo}`;
      clientsBySlug.set(slug.toLowerCase(), { github, repo: bridge.githubRepo });
      bridgeSlugsByProject.set(bridge.paperclipProjectId, [
        ...bridgeSlugsByProject.get(bridge.paperclipProjectId) ?? [],
        slug
      ]);
      depsByProject.set(bridge.paperclipProjectId, {
        db: ctx.db,
        github,
        config: {
          githubRepo: bridge.githubRepo,
          syncLabelPaperclip: bridge.syncLabelPaperclip,
          syncMarkerGithub: bridge.syncMarkerGithub
        },
        logger: ctx.logger,
        getIssue: (issueId, companyId) => withRestFallback(
          restFallbackDeps(ctx, cfg),
          "sync.get",
          () => ctx.issues.get(issueId, companyId),
          async (rest) => await rest.getIssue(issueId)
        ),
        postOpsPing: async (content, kind = "outcome") => {
          if (wantPing(cfg, kind)) await postOpsPing(ctx, cfg.opsWebhookUrl, content);
        },
        resolveRepoClient
      });
      ctx.logger.info("bridge active", {
        repo: `${bridge.githubOrg}/${bridge.githubRepo}`,
        projectId: bridge.paperclipProjectId,
        auth: brokerUrl ? "gh-token-broker" : "static token"
      });
    }
    if (depsByProject.size === 0) {
      ctx.logger.warn("no usable bridges (all missing auth) \u2014 GitHub Sync is INACTIVE.");
      return;
    }
    for (const [projectId, slugs] of bridgeSlugsByProject) {
      if (slugs.length > 1) {
        ctx.logger.warn(
          "multiple bridges share one paperclipProjectId \u2014 issue-event dispatch uses only the LAST bridge's config",
          { projectId, bridges: slugs }
        );
      }
    }
    ctx.events.on("issue.created", makeDispatch(ctx, cfg, depsByProject, handleIssueCreated, "issue.created"));
    ctx.events.on("issue.updated", makeDispatch(ctx, cfg, depsByProject, handleIssueUpdated, "issue.updated"));
    ctx.events.on("issue.updated", makeDispatch(ctx, cfg, depsByProject, handleReviewSignoff, "issue.updated:signoff"));
    ctx.jobs.register("mirror-reconcile", async () => {
      try {
        if (!cfg.companyId) {
          ctx.logger.warn("mirror-reconcile: companyId not configured; skipping sweep");
          return;
        }
        const summary = await runMirrorReconcile({
          companyId: cfg.companyId,
          projectIds: Array.from(depsByProject.keys()),
          // REST fallback is NOT optional here (GOL-1163). A scheduled job has no
          // ambient invocation scope — there is no webhook delivery or event
          // dispatch to inherit one from — so this privileged read is the single
          // most scope-fragile call in the plugin. Bare, it threw "referenced a
          // missing, expired, or unknown invocation scope" on 2026-08-03 21:23Z
          // and the sweep has not created a twin since (38 issues left unmapped).
          // Same withRestFallback the inbound mirror path uses (GOL-323).
          listIssues: (projectId, status, offset, limit) => withRestFallback(
            restFallbackDeps(ctx, cfg),
            "reconcile.list",
            () => ctx.issues.list({
              companyId: cfg.companyId,
              projectId,
              status,
              offset,
              limit
            }),
            async (rest) => await rest.listIssues(cfg.companyId, {
              projectId,
              status,
              offset,
              limit
            })
          ),
          depsForProject: (projectId) => depsByProject.get(projectId),
          logger: ctx.logger
        });
        ctx.logger.info("mirror-reconcile complete", summary);
        if (summary.created > 0 || summary.failed > 0) {
          if (wantPing(cfg, "outcome")) await postOpsPing(ctx, cfg.opsWebhookUrl, buildReconcilePing(summary));
        }
      } catch (err) {
        await recordSwallowedFailure(ctx, cfg, "mirror-reconcile job failed", err, {});
      }
    });
    const signoffDeps = depsByProject.values().next().value;
    ctx.jobs.register("signoff-reconcile", async () => {
      try {
        if (!cfg.companyId) {
          ctx.logger.warn("signoff-reconcile: companyId not configured; skipping sweep");
          return;
        }
        const companyId = cfg.companyId;
        const sinceIso = new Date(Date.now() - SIGNOFF_RECONCILE_WINDOW_MS).toISOString();
        const summary = await runSignoffReconcile({
          companyId,
          sinceIso,
          limit: SIGNOFF_RECONCILE_ROW_CAP,
          listRows: (since, limit) => listReviewRecordsUpdatedSince(ctx.db, since, limit),
          getIssueStatus: async (issueId, cId) => (await signoffDeps.getIssue(issueId, cId))?.status ?? null,
          resolveRepoClient,
          driveSignoff: (issueId) => handleReviewSignoff(signoffDeps, { issueId, companyId }),
          logger: ctx.logger
        });
        ctx.logger.info("signoff-reconcile complete", summary);
      } catch (err) {
        await recordSwallowedFailure(ctx, cfg, "signoff-reconcile job failed", err, {});
      }
    });
    ctx.jobs.register("inbound-close-reconcile", async () => {
      try {
        if (!cfg.companyId) {
          ctx.logger.warn("inbound-close-reconcile: companyId not configured; skipping sweep");
          return;
        }
        const sinceIso = new Date(Date.now() - INBOUND_CLOSE_RECONCILE_WINDOW_MS).toISOString();
        const summary = await runInboundCloseReconcile({
          repoSlugs: Array.from(clientsBySlug.keys()),
          listIssues: async (repoSlug) => {
            const entry = clientsBySlug.get(repoSlug);
            if (!entry) return { ok: false, error: "no client for repo" };
            const res = await entry.github.listIssues(entry.repo, {
              state: "all",
              since: sinceIso,
              maxPages: INBOUND_CLOSE_RECONCILE_MAX_PAGES
            });
            if (!res.ok) return { ok: false, error: res.error };
            return {
              ok: true,
              issues: res.data.issues.map((i) => ({ number: i.number, state: i.state })),
              truncated: res.data.truncated
            };
          },
          // Re-drive the event handler with NO ambient scope ((fn) => fn()); its
          // ctx.issues.get/update go through withRestFallback, so a cron-tick scope
          // expiry falls back to the Paperclip REST API (GOL-323/GOL-1163).
          driveClosure: ({ action, repoSlug, number }) => handleAppClosure(
            ctx,
            cfg,
            { action, payload: { repo: repoSlug, number, title: "", body: "", url: "" } },
            (fn) => fn()
          ),
          logger: ctx.logger
        });
        ctx.logger.info("inbound-close-reconcile complete", summary);
        if (summary.propagated > 0 || summary.failed > 0 || summary.pruned > 0) {
          if (wantPing(cfg, "outcome"))
            await postOpsPing(ctx, cfg.opsWebhookUrl, buildInboundCloseReconcilePing(summary));
        }
      } catch (err) {
        await recordSwallowedFailure(ctx, cfg, "inbound-close-reconcile job failed", err, {});
      }
    });
    ctx.jobs.register("inbound-create-reconcile", async () => {
      try {
        if (!cfg.companyId) {
          ctx.logger.warn("inbound-create-reconcile: companyId not configured; skipping sweep");
          return;
        }
        const sinceIso = new Date(Date.now() - INBOUND_CREATE_RECONCILE_WINDOW_MS).toISOString();
        const summary = await runInboundCreateReconcile({
          repoSlugs: Array.from(clientsBySlug.keys()),
          // state:"open" — never create a pre-closed mirror (the close leg is
          // inbound-close-reconcile's job); `since` bounds the scan to the window.
          listIssues: async (repoSlug) => {
            const entry = clientsBySlug.get(repoSlug);
            if (!entry) return { ok: false, error: "no client for repo" };
            const res = await entry.github.listIssues(entry.repo, {
              state: "open",
              since: sinceIso,
              maxPages: INBOUND_CREATE_RECONCILE_MAX_PAGES
            });
            if (!res.ok) return { ok: false, error: res.error };
            return {
              ok: true,
              issues: res.data.issues.map((i) => ({
                number: i.number,
                state: i.state,
                title: i.title,
                body: i.body,
                url: i.htmlUrl,
                labels: i.labels
              })),
              truncated: res.data.truncated
            };
          },
          // Re-drive the SAME inbound mirror-create the webhook uses. Owns the guards
          // (bridge / closed / Paperclip-origin label / already-mapped) so the sweep
          // tallies without duplicating createMirrorIssue's internals. No ambient
          // scope ((fn) => fn()); createMirrorIssue's writes go through withRestFallback,
          // so a cron-tick scope expiry falls back to the Paperclip REST API (GOL-323).
          driveCreate: async ({ repoSlug, issue }) => {
            const bridge = matchBridge(cfg, repoSlug);
            if (!bridge) return "no-bridge";
            if (issue.state === "closed") return "skipped-closed";
            if (issue.labels.some((l) => l.toLowerCase() === bridge.syncLabelPaperclip.toLowerCase())) {
              return "skipped-paperclip-origin";
            }
            if (await getByRepoNumber(ctx.db, repoSlug, issue.number)) return "skipped-mapped";
            await createMirrorIssue(
              ctx,
              cfg,
              bridge,
              { repo: repoSlug, number: issue.number, title: issue.title, body: issue.body, url: issue.url },
              issue.labels,
              (fn) => fn()
            );
            return await getByRepoNumber(ctx.db, repoSlug, issue.number) ? "created" : "failed";
          },
          logger: ctx.logger
        });
        ctx.logger.info("inbound-create-reconcile complete", summary);
        if (summary.created > 0 || summary.failed > 0) {
          if (wantPing(cfg, "outcome"))
            await postOpsPing(ctx, cfg.opsWebhookUrl, buildInboundCreateReconcilePing(summary));
        }
      } catch (err) {
        await recordSwallowedFailure(ctx, cfg, "inbound-create-reconcile job failed", err, {});
      }
    });
    ctx.logger.info("github sync listening", {
      projects: Array.from(depsByProject.keys())
    });
  },
  /**
   * Inbound leg (GitHub → Paperclip). The host routes three public endpoints here:
   *   - `POST …/webhooks/github-issue` → a custom Actions-workflow payload,
   *   - `POST …/webhooks/github-app`   → the App's single webhook URL: `issues` and
   *       `pull_request` both arrive here and are fanned out by X-GitHub-Event, or
   *   - `POST …/webhooks/github-pr`    → GitHub's native `pull_request` event (review
   *       pipeline) via a direct-ingress path (e.g. Terra's CF bypass).
   * Each verifies its own HMAC (the plugin's responsibility) then creates the
   * mirror/review issue directly — routines can't, since every routine run needs an agent.
   */
  async onWebhook(input) {
    const ctx = currentContext;
    if (!ctx) return;
    const runInScope = captureInvocationScope();
    let cfg;
    try {
      cfg = readConfig(await ctx.config.get());
      if (input.endpointKey === INBOUND_ENDPOINT_KEY) {
        await handleCustomInbound(ctx, cfg, input, runInScope);
      } else if (input.endpointKey === APP_WEBHOOK_ENDPOINT_KEY) {
        const ghEvent = getHeader(input.headers, "x-github-event");
        if (ghEvent === "pull_request") {
          await handlePrInbound(ctx, cfg, input);
        } else if (ghEvent === "check_suite" || ghEvent === "workflow_run") {
          await handleCiCompletion(ctx, cfg, input, ghEvent);
        } else {
          await handleAppInbound(ctx, cfg, input, runInScope);
        }
      } else if (input.endpointKey === PR_WEBHOOK_ENDPOINT_KEY) {
        await handlePrInbound(ctx, cfg, input);
      } else {
        ctx.logger.warn("inbound webhook: unknown endpoint", { endpointKey: input.endpointKey });
      }
      await safeRecordDelivery(ctx, input, "processed");
    } catch (err) {
      if (err instanceof WebhookRejection) {
        await safeRecordDelivery(ctx, input, err.outcome, err.message);
        throw err;
      }
      const scope = `inbound webhook: handler failed (${input.endpointKey})`;
      const detail = err instanceof Error ? err.message : String(err);
      await safeRecordDelivery(ctx, input, "failed_processing", detail);
      if (cfg) {
        await recordSwallowedFailure(ctx, cfg, scope, err, { endpointKey: input.endpointKey });
      } else {
        ctx.logger.error(scope, { endpointKey: input.endpointKey, error: detail });
        try {
          await recordError(ctx.db, {
            occurredAt: (/* @__PURE__ */ new Date()).toISOString(),
            scope,
            detail,
            context: { endpointKey: input.endpointKey }
          });
        } catch {
        }
      }
      throw err;
    }
  },
  async onHealth() {
    return { status: "ok" };
  }
});
var worker_default = plugin;
runWorker(plugin, import.meta.url);
export {
  worker_default as default
};
