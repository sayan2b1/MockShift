from typing import List, Dict, Optional, Literal
from pydantic import BaseModel, Field

class McqOptions(BaseModel):
    A: Optional[str] = Field(default=None, description="Option A text for MCQ")
    B: Optional[str] = Field(default=None, description="Option B text for MCQ")
    C: Optional[str] = Field(default=None, description="Option C text for MCQ")
    D: Optional[str] = Field(default=None, description="Option D text for MCQ")

class Question(BaseModel):
    id: int = Field(description="Unique numeric identifier for the question")
    section: str = Field(description="Section name (e.g., 'Physics', 'Chemistry', 'Mathematics', 'General Aptitude')")
    type: Literal["MCQ", "MSQ", "NAT"] = Field(
        default="MCQ",
        description="Question type: 'MCQ' (Single Choice, only 1 option correct), 'MSQ' (Multiple Select, one or more options can be correct), or 'NAT' (Numerical Answer Type / TITA without options)"
    )
    text: str = Field(description="Full question stem/text. Mathematical formulas should be properly formatted in LaTeX using $...$ for inline or $$...$$ for display.")
    options: Optional[McqOptions] = Field(
        default=None,
        description="Options for MCQ and MSQ with fields A, B, C, D. Must be null for NAT questions."
    )
    correct_answer: Optional[str] = Field(
        default=None,
        description="Correct answer identifier: single letter e.g. 'A' for MCQ; comma-separated letters e.g. 'A, C' or 'B, D' for MSQ; numerical value e.g. '42.5' for NAT; or null if absent"
    )
    marks_positive: float = Field(default=3.0, description="Marks awarded for a correct answer")
    marks_negative: float = Field(default=1.0, description="Marks deducted for an incorrect answer (usually 0 for NAT and MSQ)")
    has_image: bool = Field(default=False, description="Set to true if this question contains a diagram, figure, circuit, plot, graph, or chemical structure")
    image_page: Optional[int] = Field(default=None, description="1-based page number in the PDF where this question's diagram appears, if any")
    image_bbox: Optional[List[float]] = Field(default=None, description="Bounding box [ymin, xmin, ymax, xmax] tightly enclosing ONLY the diagram on that page (integers 0-1000 or floats 0.0-1.0), or null if no diagram")
    image_data: Optional[str] = Field(default=None, description="Base64 encoded Data URI of the cropped question diagram (populated by PyMuPDF)")

class ExamPaper(BaseModel):
    exam_title: str = Field(description="Title of the examination / question paper")
    exam_mode: str = Field(
        default="CAT",
        description="Examination format archetype e.g. CAT, GATE, JEE, NEET, UPSC_GS, UPSC_CSAT, SSC, RAILWAYS, BANKING, CUET, CUSTOM"
    )
    duration_minutes: int = Field(default=180, description="Total examination duration in minutes")
    sections: List[str] = Field(description="List of section names in the examination")
    questions: List[Question] = Field(description="List of all questions in the examination")

class SolveBatchRequest(BaseModel):
    questions: List[Question] = Field(description="List of attempted questions with missing answers")

class AnswerItem(BaseModel):
    q_id: int = Field(description="Numeric question ID")
    answer: str = Field(description="Final answer identifier or numerical value e.g. 'A', 'B', '42.5'")

class AiSolveBatchResponse(BaseModel):
    answers: List[AnswerItem] = Field(description="List of resolved answers")

class BatchSolveResult(BaseModel):
    answers: Dict[str, str] = Field(
        description="Mapping of question id (as string) to verified final answer key e.g. {'1': 'A', '2': '42.5'}"
    )

class MistakeAutopsyRequest(BaseModel):
    question: Question
    user_answer: Optional[str] = None
    correct_answer: Optional[str] = None
    time_spent: Optional[int] = Field(default=0, description="Time spent on this question in seconds")
    exam_mode: Optional[str] = Field(default="CUSTOM", description="Exam mode archetype (e.g. CAT, GATE, JEE, NEET, CUET, CUSTOM)")

class MistakeAutopsyResponse(BaseModel):
    root_cause: str = Field(description="Root-cause diagnosis of the error: 'Conceptual Gap', 'Sign/Calculation Slip', 'Misread Constraint', 'Distractor Trap', or 'Time Trap'")
    core_concept: str = Field(description="The underlying concept or principle tested by this question (e.g. 'Rotational Dynamics', 'Bayes Theorem')")
    formula_used: str = Field(description="Key mathematical formula or theoretical rule formatted in LaTeX ($...$)")
    step_by_step_solution: List[str] = Field(description="Clear, numbered logical progression leading to the correct answer, with LaTeX math")
    time_saver_shortcut: str = Field(description="Exam-hall speed hack, elimination tactic, or sanity check to solve this in under 60 seconds")
    common_trap: str = Field(description="Analysis of why aspirants commonly fail or select distractors on this question")

class WeaknessDrillRequest(BaseModel):
    wrong_questions: List[Question] = Field(description="Up to 5 questions that the student answered incorrectly, fell into time traps, or skipped")
    exam_mode: Optional[str] = Field(default="CUSTOM", description="Exam mode format")
    weak_concepts: Optional[List[str]] = Field(default=[], description="List of identified weak concept tags from mistimed or incorrect questions")

