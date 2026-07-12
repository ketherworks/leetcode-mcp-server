export interface AnonymousLeetCodeService {
    fetchProblem(titleSlug: string): Promise<unknown>;
    searchProblems(
        category?: string,
        tags?: string[],
        difficulty?: string,
        limit?: number,
        offset?: number,
        searchKeywords?: string
    ): Promise<unknown>;
    isAuthenticated(): boolean;
    isCN(): boolean;
}
