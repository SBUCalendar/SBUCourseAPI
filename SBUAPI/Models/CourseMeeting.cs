namespace SBUAPI.Models;

public sealed class CourseMeeting
{
    public int Id { get; set; }

    public string Type { get; set; } = "";
    public string Day { get; set; } = "";
    public string StartTime { get; set; } = "";
    public string EndTime { get; set; } = "";

    public int CourseId { get; set; }
    public Course Course { get; set; } = null!;
}