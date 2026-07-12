import { describe, expect, test, vi } from "vitest";
import { createAnonymousService } from "../../src/anonymous-service.js";
import { createFakeService } from "./fixtures.js";

describe("anonymous service creation", () => {
    test("always passes an undefined session to LeetCodeServiceFactory", async () => {
        const service = createFakeService();
        const factory = { createService: vi.fn(async () => service) };

        await expect(createAnonymousService("cn", factory)).resolves.toBe(
            service
        );
        expect(factory.createService).toHaveBeenCalledWith("cn", undefined);
    });

    test("rejects a factory result that reports authentication", async () => {
        const service = createFakeService({ isAuthenticated: () => true });
        const factory = { createService: vi.fn(async () => service) };

        await expect(createAnonymousService("global", factory)).rejects.toThrow(
            "Anonymous LeetCode service assertion failed"
        );
    });
});
