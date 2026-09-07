namespace SBUAPI.Models;

public sealed class AdminBehestanViewModel
{
    public BehestanSessionInput Session { get; set; } = new();

    public bool? Success { get; set; }

    public string? Message { get; set; }

    public int CourseCount { get; set; }
}
