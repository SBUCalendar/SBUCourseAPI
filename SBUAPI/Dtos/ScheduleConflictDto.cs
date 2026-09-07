namespace SBUAPI.Dtos;

public sealed class ScheduleConflictDto
{
    public string Type { get; set; } = "";

    public int FirstCourseId { get; set; }
    public string FirstCourseName { get; set; } = "";

    public int SecondCourseId { get; set; }
    public string SecondCourseName { get; set; } = "";

    public string DayOrDate { get; set; } = "";

    public string FirstTime { get; set; } = "";
    public string SecondTime { get; set; } = "";
}