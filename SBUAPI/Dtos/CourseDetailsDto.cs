namespace SBUAPI.Dtos;

public sealed class CourseDetailsDto
{
    public int Id { get; set; }

    public string TermCode { get; set; } = "";

    public string CourseCode { get; set; } = "";
    public string Group { get; set; } = "";
    public string Name { get; set; } = "";

    public int Units { get; set; }
    public int PracticalUnits { get; set; }

    public string FacultyCode { get; set; } = "";
    public string FacultyName { get; set; } = "";

    public string DepartmentCode { get; set; } = "";
    public string DepartmentName { get; set; } = "";

    public int Capacity { get; set; }
    public int Registered { get; set; }
    public int Waitlist { get; set; }

    public string Gender { get; set; } = "";

    public List<string> Professors { get; set; } = [];

    public List<CourseMeetingDto> Meetings { get; set; } = [];

    public CourseExamDto? Exam { get; set; }

    public string Restrictions { get; set; } = "";
    public string EntryRestriction { get; set; } = "";
    public string ConflictingCourses { get; set; } = "";
    public string OfferingMethod { get; set; } = "";
    public string CoursePeriod { get; set; } = "";
    public string Notes { get; set; } = "";
}