import { z } from "zod";
import { LeetCodeSite } from "../cli.js";
import {
    leetCodeFetchInputSchema,
    leetCodeSearchInputSchema,
    OjProblemRef
} from "./contracts.js";
import { LeetCodeAdapterError } from "./errors.js";
import { getLeetCodeSiteDescriptor } from "./transport.js";

export const MAX_CURSOR_OFFSET = 10_000;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type AuditedTag =
    | string
    | {
          id?: string;
          slug: string;
          name?: string;
          translatedName?: string;
      };

export interface AuditedCodeSnippet {
    lang?: string;
    langSlug: string;
    code: string;
}

export interface AuditedPublicSearchItem {
    title: string;
    titleCn?: string;
    titleSlug: string;
    difficulty?: string;
    acRate?: number;
    topicTags: AuditedTag[];
}

export interface AuditedPublicSearchPage {
    total: number;
    hasMore?: boolean;
    rawQuestionCount: number;
    items: AuditedPublicSearchItem[];
}

export interface AuditedPublicProblem {
    nativeId: string;
    title: string;
    statement: string;
    difficulty?: string;
    topicTags: AuditedTag[];
    codeSnippets: AuditedCodeSnippet[];
}

export interface ValidatedSearchRequest {
    requestId: string;
    query: string;
    limit: number;
    offset: number;
    locale: "en-US" | "zh-CN";
}

const rawTagObjectSchema = z
    .object({
        id: z.string().min(1).nullable().optional(),
        slug: z.string().min(1),
        name: z.string().nullable().optional(),
        translatedName: z.string().nullable().optional()
    })
    .passthrough();

const rawTagSchema = z.union([z.string().min(1), rawTagObjectSchema]);

const rawSearchQuestionSchema = z
    .object({
        title: z.string().min(1),
        titleCn: z.string().nullable().optional(),
        titleSlug: z.string().min(1).max(128).regex(SLUG_PATTERN),
        difficulty: z.string().min(1).nullable().optional(),
        acRate: z.number().finite().nullable().optional(),
        topicTags: z.array(rawTagSchema).max(50).nullable().optional(),
        paidOnly: z.unknown().optional(),
        isPaidOnly: z.unknown().optional()
    })
    .passthrough();

const rawSearchPageSchema = z
    .object({
        hasMore: z.boolean().optional(),
        total: z.number().int().nonnegative(),
        questions: z.array(rawSearchQuestionSchema).max(50)
    })
    .passthrough();

const rawCodeSnippetSchema = z
    .object({
        lang: z.string().min(1).nullable().optional(),
        langSlug: z.string().min(1).max(64),
        code: z.string()
    })
    .passthrough();

const rawProblemSchema = z
    .object({
        title: z.string().min(1).nullable().optional(),
        translatedTitle: z.string().nullable().optional(),
        titleSlug: z.string().min(1).nullable().optional(),
        content: z.string().nullable().optional(),
        translatedContent: z.string().nullable().optional(),
        difficulty: z.string().min(1).nullable().optional(),
        isPaidOnly: z.unknown().optional(),
        paidOnly: z.unknown().optional(),
        topicTags: z.array(rawTagSchema).max(50).nullable().optional(),
        codeSnippets: z
            .array(rawCodeSnippetSchema)
            .max(50)
            .nullable()
            .optional()
    })
    .passthrough();

export function parseBoundedCursor(cursor: string | undefined): number {
    if (!cursor) {
        return 0;
    }
    const match = /^v1:(0|[1-9]\d{0,4})$/.exec(cursor);
    if (!match) {
        throw new LeetCodeAdapterError(
            "request.invalid",
            "LeetCode search cursor is outside the supported bounds."
        );
    }
    const offset = Number(match[1]);
    if (offset > MAX_CURSOR_OFFSET) {
        throw new LeetCodeAdapterError(
            "request.invalid",
            "LeetCode search cursor is outside the supported bounds."
        );
    }
    return offset;
}

export function evaluatePremiumAccess(
    record: { isPaidOnly?: unknown; paidOnly?: unknown },
    site: LeetCodeSite,
    operation: "search" | "fetch"
): "public" | "premium" {
    const descriptor = getLeetCodeSiteDescriptor(site);
    const primaryField =
        operation === "search"
            ? descriptor.searchPaidMarkerField
            : descriptor.fetchPaidMarkerField;
    const secondaryField =
        primaryField === "paidOnly" ? "isPaidOnly" : "paidOnly";

    const primaryMarker = record[primaryField];
    if (typeof primaryMarker !== "boolean") {
        throw new LeetCodeAdapterError(
            "upstream.schema_changed",
            "LeetCode response omitted the audited Premium access marker."
        );
    }

    const secondaryMarker = record[secondaryField];
    if (secondaryMarker !== undefined) {
        if (typeof secondaryMarker !== "boolean") {
            throw new LeetCodeAdapterError(
                "upstream.schema_changed",
                "LeetCode response contained a malformed Premium access marker."
            );
        }
        if (secondaryMarker !== primaryMarker) {
            throw new LeetCodeAdapterError(
                "upstream.schema_changed",
                "LeetCode response contained contradictory Premium access markers."
            );
        }
    }

    return primaryMarker ? "premium" : "public";
}

export class LeetCodePolicyGuard {
    assertAnonymousTransport(transport: { isAuthenticated(): boolean }): void {
        if (transport.isAuthenticated()) {
            throw new Error("Anonymous LeetCode service assertion failed.");
        }
    }

    validateSearchRequest(
        input: unknown,
        site: LeetCodeSite
    ): ValidatedSearchRequest {
        const parsed = leetCodeSearchInputSchema.safeParse(input);
        if (!parsed.success) {
            throw new LeetCodeAdapterError(
                "request.invalid",
                "LeetCode search input did not match its strict bounded schema."
            );
        }
        const descriptor = getLeetCodeSiteDescriptor(site);
        if (
            parsed.data.locale !== undefined &&
            parsed.data.locale !== descriptor.locale
        ) {
            throw new LeetCodeAdapterError(
                "request.invalid",
                "Locale must match the configured LeetCode site."
            );
        }
        const offset = parseBoundedCursor(parsed.data.cursor);
        return {
            requestId: parsed.data.requestId,
            query: parsed.data.query,
            limit: parsed.data.limit,
            offset,
            locale: descriptor.locale
        };
    }

    validateFetchRequest(input: unknown, site: LeetCodeSite): OjProblemRef {
        const parsed = leetCodeFetchInputSchema.safeParse(input);
        if (!parsed.success) {
            throw new LeetCodeAdapterError(
                "request.invalid",
                "LeetCode fetch input did not match its strict bounded schema."
            );
        }
        const ref = parsed.data;
        if (ref.site !== site) {
            throw new LeetCodeAdapterError(
                "request.invalid",
                "Problem reference site must match the configured LeetCode site."
            );
        }
        const descriptor = getLeetCodeSiteDescriptor(site);
        if (
            ref.nativeId.length > 128 ||
            !SLUG_PATTERN.test(ref.nativeId) ||
            ref.canonicalId !== descriptor.canonicalId(ref.nativeId) ||
            ref.url !== descriptor.problemUrl(ref.nativeId)
        ) {
            throw new LeetCodeAdapterError(
                "request.invalid",
                "Problem reference identity does not match its LeetCode site and slug."
            );
        }
        return ref;
    }

    guardSearchPage(raw: unknown, site: LeetCodeSite): AuditedPublicSearchPage {
        const parsed = rawSearchPageSchema.safeParse(raw);
        if (!parsed.success) {
            throw new LeetCodeAdapterError(
                "upstream.schema_changed",
                "LeetCode search response no longer matches the audited adapter schema.",
                { cause: parsed.error }
            );
        }

        const classified = parsed.data.questions.map((question) => ({
            question,
            access: evaluatePremiumAccess(question, site, "search")
        }));

        const items: AuditedPublicSearchItem[] = classified
            .filter(({ access }) => access === "public")
            .map(({ question }) => ({
                title: question.title,
                titleCn: nonEmptyString(question.titleCn),
                titleSlug: question.titleSlug,
                difficulty: question.difficulty ?? undefined,
                acRate: question.acRate ?? undefined,
                topicTags: sanitizeTags(question.topicTags ?? [])
            }));

        return {
            total: parsed.data.total,
            hasMore: parsed.data.hasMore,
            rawQuestionCount: parsed.data.questions.length,
            items
        };
    }

    guardFetchedProblem(
        raw: unknown,
        requestedNativeId: string,
        site: LeetCodeSite
    ): AuditedPublicProblem {
        if (!raw) {
            throw new LeetCodeAdapterError(
                "resource.not_found",
                "The requested LeetCode problem was not found."
            );
        }
        const parsed = rawProblemSchema.safeParse(raw);
        if (!parsed.success) {
            throw new LeetCodeAdapterError(
                "upstream.schema_changed",
                "LeetCode problem response no longer matches the audited adapter schema.",
                { cause: parsed.error }
            );
        }

        const problem = parsed.data;
        if (evaluatePremiumAccess(problem, site, "fetch") === "premium") {
            throw new LeetCodeAdapterError(
                "policy.blocked",
                "Premium LeetCode problem content is excluded by adapter policy."
            );
        }

        if (problem.titleSlug && problem.titleSlug !== requestedNativeId) {
            throw new LeetCodeAdapterError(
                "upstream.schema_changed",
                "LeetCode returned a problem identifier that did not match the request."
            );
        }

        const title =
            site === "cn"
                ? (nonEmptyString(problem.translatedTitle) ??
                  nonEmptyString(problem.title))
                : nonEmptyString(problem.title);
        const statement =
            site === "cn"
                ? (nonEmptyString(problem.translatedContent) ??
                  nonEmptyString(problem.content))
                : nonEmptyString(problem.content);

        if (!title || !statement) {
            throw new LeetCodeAdapterError(
                "upstream.schema_changed",
                "LeetCode problem response did not contain a public title and statement."
            );
        }

        return {
            nativeId: requestedNativeId,
            title,
            statement,
            difficulty: problem.difficulty ?? undefined,
            topicTags: sanitizeTags(problem.topicTags ?? []),
            codeSnippets: sanitizeSnippets(problem.codeSnippets ?? [])
        };
    }
}

function nonEmptyString(value: string | null | undefined): string | undefined {
    if (typeof value !== "string" || value.trim().length === 0) {
        return undefined;
    }
    return value;
}

function sanitizeTags(tags: Array<z.infer<typeof rawTagSchema>>): AuditedTag[] {
    return tags.map((tag) => {
        if (typeof tag === "string") {
            return tag;
        }
        return {
            id: nonEmptyString(tag.id),
            slug: tag.slug,
            name: nonEmptyString(tag.name),
            translatedName: nonEmptyString(tag.translatedName)
        };
    });
}

function sanitizeSnippets(
    snippets: Array<z.infer<typeof rawCodeSnippetSchema>>
): AuditedCodeSnippet[] {
    return snippets.map((snippet) => ({
        lang: nonEmptyString(snippet.lang),
        langSlug: snippet.langSlug,
        code: snippet.code
    }));
}
