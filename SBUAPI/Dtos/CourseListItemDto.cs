namespace SBUAPI.Dtos;

public sealed class CourseListItemDto
{
    public int Id { get; set; }

    public string CourseCode { get; set; } = "";
    public string Group { get; set; } = "";
    public string Name { get; set; } = "";

    public int Units { get; set; }
    public int PracticalUnits { get; set; }

    public string FacultyName { get; set; } = "";
    public string DepartmentName { get; set; } = "";

    public int Capacity { get; set; }
    public int Registered { get; set; }
    public int Waitlist { get; set; }

    public string Gender { get; set; } = "";

    public string Restrictions { get; set; } = "";
    public string Notes { get; set; } = "";

    public List<string> Professors { get; set; } = [];
    public List<CourseMeetingDto> Meetings { get; set; } = [];

    public CourseExamDto? Exam { get; set; }
}

public sealed class CourseMeetingDto
{
    public string Type { get; set; } = "";
    public string Day { get; set; } = "";
    public string StartTime { get; set; } = "";
    public string EndTime { get; set; } = "";
}

public sealed class CourseExamDto
{
    public string Date { get; set; } = "";
    public string StartTime { get; set; } = "";
    public string EndTime { get; set; } = "";
}
