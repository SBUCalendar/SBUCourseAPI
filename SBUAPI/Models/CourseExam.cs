namespace SBUAPI.Models;

public sealed class CourseExam
{
    public int Id { get; set; }

    public string Date { get; set; } = "";
    public string StartTime { get; set; } = "";
    public string EndTime { get; set; } = "";

    public int CourseId { get; set; }
    public Course Course { get; set; } = null!;
}