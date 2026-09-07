namespace SbuCourses.Models;

public sealed record BehestanFetchResult(
    bool Success,
    int StatusCode,
    string? Ret,
    string? BMt,
    string? Error
);